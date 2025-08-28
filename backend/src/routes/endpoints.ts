import { Elysia, t } from 'elysia';
import { Database } from 'bun:sqlite';
import type { Endpoint } from '../types';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';
import { MonitoringService } from '../services/monitoring';
import { DomainInfoService } from '../services/domain-info';
import { CertificateService } from '../services/certificate';
import { validateEndpoint } from '../utils/validation';
import { calculateGapAwareUptime } from '../utils/uptime';
import { formatDuration } from '../utils/formatting';
import { calculateResponseTimeStatistics } from '../utils/statistics';

export function createEndpointsRoutes(
  db: Database,
  authService: AuthService, 
  logger: LoggerService,
  monitoringService: MonitoringService,
  domainInfoService: DomainInfoService,
  certificateService: CertificateService,
  requireAuth: (handler: any) => any,
  requireRole: (role: 'admin' | 'user') => (handler: any) => any
) {
  
  return new Elysia({ prefix: '/api' })
    .get('/endpoints', async () => {
      const endpoints: Endpoint[] = db.query('SELECT * FROM endpoints').all() as Endpoint[];
      const endpointsWithStats = await Promise.all(
        endpoints.map(async (endpoint) => {
          const lastResponse = db.query('SELECT response_time FROM response_times WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT 1').get(endpoint.id) as any;

          const stats24h = await calculateGapAwareUptime(db, endpoint.id, endpoint.heartbeat_interval || 60, '1 day');
          const stats30d = await calculateGapAwareUptime(db, endpoint.id, endpoint.heartbeat_interval || 60, '30 days');
          const stats1y = await calculateGapAwareUptime(db, endpoint.id, endpoint.heartbeat_interval || 60, '365 days');

          const uptime_30d = stats30d?.uptime || 0;
          const uptime_1y = stats1y?.uptime || 0;

          const result = {
            ...endpoint,
            ok_http_statuses: endpoint.ok_http_statuses ? JSON.parse(endpoint.ok_http_statuses) : [],
            http_headers: endpoint.http_headers ? JSON.parse(endpoint.http_headers) : null,
            kafka_config: endpoint.kafka_config ? JSON.parse(endpoint.kafka_config) : null,
            // Properly convert SQLite integer values to booleans
            paused: Boolean(endpoint.paused),
            upside_down_mode: Boolean(endpoint.upside_down_mode),
            check_cert_expiry: Boolean(endpoint.check_cert_expiry),
            client_cert_enabled: Boolean(endpoint.client_cert_enabled),
            kafka_consumer_read_single: Boolean(endpoint.kafka_consumer_read_single),
            kafka_consumer_auto_commit: Boolean(endpoint.kafka_consumer_auto_commit),
            current_response: lastResponse?.response_time || 0,
            avg_response_24h: stats24h?.avg_response || 0,
            uptime_24h: stats24h?.uptime || 0,
            uptime_30d,
            uptime_1y,
            cert_expires_in: endpoint.cert_expires_in,
            cert_expiry_date: endpoint.cert_expiry_date,
          };
          return result;
        })
      );
      return endpointsWithStats;
    })
    .get('/endpoints/:id/stats', async ({ params, query }) => {
      const { id } = params;
      const range = (query.range || '24h') as '3h' | '6h' | '24h' | '1w';

      // Get endpoint heartbeat interval for gap-aware calculation
      const endpoint = db.query('SELECT heartbeat_interval FROM endpoints WHERE id = ?').get(id) as any;
      const heartbeatInterval = endpoint?.heartbeat_interval || 60;

      const rangeToPeriod = {
        '3h': '3 hours',
        '6h': '6 hours', 
        '24h': '1 day',
        '1w': '7 days',
      };

      const period = rangeToPeriod[range];
      const stats = await calculateGapAwareUptime(db, parseInt(id), heartbeatInterval, period);

      // Get response times for statistical calculations
      const rangeToSql = {
        '3h': "datetime('now', '-3 hours')",
        '6h': "datetime('now', '-6 hours')",
        '24h': "datetime('now', '-1 day')",
        '1w': "datetime('now', '-7 days')",
      };

      const since = rangeToSql[range];
      const responseTimes = db.query(
        `SELECT response_time FROM response_times 
         WHERE endpoint_id = ? AND created_at >= ${since} AND response_time IS NOT NULL AND response_time > 0
         ORDER BY created_at ASC`
      ).all(id) as any[];

      // Calculate advanced statistics
      const responseTimeValues = responseTimes.map(row => row.response_time);
      const advancedStats = calculateResponseTimeStatistics(responseTimeValues);

      return {
        avg_response: stats?.avg_response || 0,
        uptime: stats?.uptime || 0,
        monitoring_coverage: stats?.monitoring_coverage || 0,
        // Add new statistical measures
        p50: advancedStats.p50,
        p90: advancedStats.p90,
        p95: advancedStats.p95,
        p99: advancedStats.p99,
        std_dev: advancedStats.std_dev,
        mad: advancedStats.mad,
        min_response: advancedStats.min,
        max_response: advancedStats.max,
        response_count: advancedStats.count
      };
    })
    .get('/endpoints/:id/response-times', async ({ params, query }) => {
      const { id } = params;
      const range = (query.range || '24h') as '3h' | '6h' | '24h' | '1w';

      const rangeToSql = {
        '3h': "datetime('now', '-3 hours')",
        '6h': "datetime('now', '-6 hours')",
        '24h': "datetime('now', '-1 day')",
        '1w': "datetime('now', '-7 days')",
      };

      const since = rangeToSql[range];

      // Target around 60-80 data points for all time ranges
      let groupByFormat: string;
      let intervalMinutes: number;

      switch (range) {
        case '3h':
          // Group by 3-minute intervals for 3h (60 points)
          groupByFormat = "strftime('%Y-%m-%d %H:', created_at) || printf('%02d', (cast(strftime('%M', created_at) as integer) / 3) * 3)";
          intervalMinutes = 3;
          break;
        case '6h':
          // Group by 5-minute intervals for 6h (72 points)
          groupByFormat = "strftime('%Y-%m-%d %H:', created_at) || printf('%02d', (cast(strftime('%M', created_at) as integer) / 5) * 5)";
          intervalMinutes = 5;
          break;
        case '24h':
          // Group by 20-minute intervals for 24h (72 points)
          groupByFormat = "strftime('%Y-%m-%d %H:', created_at) || printf('%02d', (cast(strftime('%M', created_at) as integer) / 20) * 20)";
          intervalMinutes = 20;
          break;
        case '1w':
          // Group by 3-hour intervals for 1 week (56 points)
          groupByFormat = "strftime('%Y-%m-%d ', created_at) || printf('%02d:00:00', (cast(strftime('%H', created_at) as integer) / 3) * 3)";
          intervalMinutes = 180;
          break;
      }

      const aggregatedData = db.query(
        `SELECT 
          ${groupByFormat} as time_bucket,
          AVG(response_time) as avg_response_time,
          MIN(response_time) as min_response_time,
          MAX(response_time) as max_response_time,
          -- Determine predominant status: if any DOWN, then DOWN, else UP
          CASE 
            WHEN COUNT(CASE WHEN status = 'DOWN' THEN 1 END) > 0 THEN 'DOWN'
            ELSE 'UP'
          END as status,
          -- Use the latest timestamp in the bucket as created_at
          MAX(created_at) as created_at,
          COUNT(*) as data_points
        FROM response_times 
        WHERE endpoint_id = ? AND created_at >= ${since}
        GROUP BY ${groupByFormat}
        ORDER BY created_at ASC`
      ).all(id) as any[];

      // Transform the aggregated data to include min/max for banded chart
      return aggregatedData.map(row => ({
        id: 0, // Not used for charts
        endpoint_id: parseInt(id),
        response_time: Math.round(row.avg_response_time),
        min_response_time: row.min_response_time,
        max_response_time: row.max_response_time,
        status: row.status,
        created_at: row.created_at,
        data_points: row.data_points // Additional info about how many points were aggregated
      }));
    })
    .get('/endpoints/:id/outages', async ({ params, query }) => {
      const { id } = params;
      const limit = parseInt(query.limit as string) || 50;

      // Get all status changes for this endpoint, ordered by time
      const statusChanges = db.query(
        `SELECT status, created_at, response_time, failure_reason
         FROM response_times 
         WHERE endpoint_id = ? 
         ORDER BY created_at DESC 
         LIMIT 1000`
      ).all(id) as any[];

      const outages: Array<{
        started_at: string;
        ended_at: string | null;
        duration_ms: number | null;
        duration_text: string;
        reason: string;
      }> = [];

      let currentOutageStart: string | null = null;
      let currentOutageReason: string = 'Service check failed';
      
      // Process status changes in reverse chronological order to build outage periods
      for (let i = statusChanges.length - 1; i >= 0; i--) {
        const change = statusChanges[i];
        
        if (change.status === 'DOWN' && !currentOutageStart) {
          // Start of an outage
          currentOutageStart = change.created_at;
          currentOutageReason = change.failure_reason || 'Service check failed';
        } else if (change.status === 'UP' && currentOutageStart) {
          // End of an outage
          const startTime = new Date(currentOutageStart);
          const endTime = new Date(change.created_at);
          const durationMs = endTime.getTime() - startTime.getTime();
          
          outages.push({
            started_at: currentOutageStart,
            ended_at: change.created_at,
            duration_ms: durationMs,
            duration_text: formatDuration(durationMs),
            reason: currentOutageReason
          });
          
          currentOutageStart = null;
          currentOutageReason = 'Service check failed';
        }
      }
      
      // If there's an ongoing outage
      if (currentOutageStart) {
        const startTime = new Date(currentOutageStart);
        const now = new Date();
        const durationMs = now.getTime() - startTime.getTime();
        
        outages.push({
          started_at: currentOutageStart,
          ended_at: null,
          duration_ms: durationMs,
          duration_text: formatDuration(durationMs) + ' (ongoing)',
          reason: currentOutageReason
        });
      }

      // Sort by most recent first and limit results
      return outages.sort((a, b) => 
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      ).slice(0, limit);
    })
    .get('/endpoints/:id/heartbeats', async ({ params, query }) => {
      const { id } = params;
      const limit = parseInt(query.limit as string) || 24;

      // Get recent heartbeats for this endpoint, ordered by time (most recent first)
      const heartbeats = db.query(
        `SELECT status, created_at, response_time
         FROM response_times 
         WHERE endpoint_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`
      ).all(id, limit) as any[];

      // Return in chronological order (oldest first) for proper display
      return heartbeats.reverse();
    })
    .get('/endpoints/:id/certificate-chain', async ({ params, set }) => {
      const { id } = params;
      
      // Get endpoint URL
      const endpoint = db.query('SELECT url, check_cert_expiry FROM endpoints WHERE id = ?').get(id) as any;
      if (!endpoint) {
        set.status = 404;
        return { error: 'Endpoint not found' };
      }

      if (!endpoint.check_cert_expiry) {
        set.status = 400;
        return { error: 'Certificate checking is not enabled for this endpoint' };
      }

      // Get certificate chain information
      const result = await certificateService.getCertificateChain(endpoint.url);
      
      if (!result.success) {
        set.status = 500;
        return { error: result.error.error, details: result.error.details };
      }

      return result.result;
    })
    .get('/endpoints/:id/domain-info', async ({ params, set }) => {
      const { id } = params;
      
      // Get cached domain info from database
      const endpoint = db.query('SELECT domain_expires_in, domain_expiry_date, domain_creation_date, domain_updated_date FROM endpoints WHERE id = ?').get(id) as any;
      if (!endpoint) {
        set.status = 404;
        return { error: 'Endpoint not found' };
      }

      // Return cached domain information (same format as DomainInfo interface)
      return {
        creationDate: endpoint.domain_creation_date ? new Date(endpoint.domain_creation_date) : null,
        updatedDate: endpoint.domain_updated_date ? new Date(endpoint.domain_updated_date) : null,
        expiryDate: endpoint.domain_expiry_date ? new Date(endpoint.domain_expiry_date) : null,
        daysRemaining: endpoint.domain_expires_in
      };
    })
    .get('/endpoints/:id/enhanced-domain-info', async ({ params, set }) => {
      const { id } = params;
      
      // Get endpoint URL and cached domain info
      const endpoint = db.query('SELECT url, domain_expires_in, domain_expiry_date, domain_creation_date, domain_updated_date FROM endpoints WHERE id = ?').get(id) as any;
      if (!endpoint) {
        set.status = 404;
        return { error: 'Endpoint not found' };
      }

      try {
        // Get enhanced domain information using the domain info service
        const domainResult = await domainInfoService.getDomainInfo(endpoint.url);
        
        // Base domain info (use fresh data if available, fallback to cached)
        const domainInfo = {
          creationDate: domainResult.success ? domainResult.result.creationDate : 
            (endpoint.domain_creation_date ? new Date(endpoint.domain_creation_date) : null),
          updatedDate: domainResult.success ? domainResult.result.updatedDate : 
            (endpoint.domain_updated_date ? new Date(endpoint.domain_updated_date) : null),
          expiryDate: domainResult.success ? domainResult.result.expiryDate : 
            (endpoint.domain_expiry_date ? new Date(endpoint.domain_expiry_date) : null),
          daysRemaining: domainResult.success ? domainResult.result.daysRemaining : endpoint.domain_expires_in
        };

        // Gather additional information
        let dnsInfo = null;
        let serverInfo = null;

        try {
          const parsedUrl = new URL(endpoint.url);
          const hostname = parsedUrl.hostname;

          // DNS lookup
          try {
            const dns = await import('dns').then(d => d.promises);
            const [aRecords, txtRecords, mxRecords, nsRecords] = await Promise.allSettled([
              dns.resolve4(hostname).catch(() => []),
              dns.resolveTxt(hostname).catch(() => []),
              dns.resolveMx(hostname).catch(() => []),
              dns.resolveNs(hostname).catch(() => [])
            ]);

            // Try CNAME lookup
            let cnameRecord = null;
            try {
              const cnames = await dns.resolveCname(hostname);
              cnameRecord = cnames[0] || null;
            } catch {
              // CNAME lookup failed, which is normal for A records
            }

            dnsInfo = {
              A: aRecords.status === 'fulfilled' ? aRecords.value : [],
              CNAME: cnameRecord,
              TXT: txtRecords.status === 'fulfilled' ? txtRecords.value.flat() : [],
              MX: mxRecords.status === 'fulfilled' ? mxRecords.value : [],
              NS: nsRecords.status === 'fulfilled' ? nsRecords.value : [],
              SOA: null // Not implemented for now
            };
          } catch (err) {
            logger.debug(`DNS lookup failed for ${hostname}: ${err}`, 'DOMAIN_INFO');
          }

          // Server info (only for HTTP endpoints)
          if (endpoint.url.startsWith('http')) {
            try {
              const response = await fetch(endpoint.url, {
                method: 'HEAD',
                signal: AbortSignal.timeout(5000)
              });
              
              serverInfo = {
                httpStatus: response.status,
                serverHeader: response.headers.get('server') || undefined
              };
            } catch (err) {
              logger.debug(`Server info check failed for ${endpoint.url}: ${err}`, 'DOMAIN_INFO');
            }
          }
        } catch (err) {
          logger.debug(`URL parsing failed for ${endpoint.url}: ${err}`, 'DOMAIN_INFO');
        }

        return {
          domain: domainInfo,
          certificate: null, // Certificate info is handled separately
          dns: dnsInfo,
          server: serverInfo
        };
      } catch (error) {
        logger.error(`Enhanced domain info failed for endpoint ${id}: ${error}`, 'DOMAIN_INFO');
        set.status = 500;
        return { error: 'Failed to fetch enhanced domain information' };
      }
    })
    .delete('/endpoints/:id/heartbeats', async ({ params }) => {
      const { id } = params;
      
      // Delete all heartbeat data (response_times) for this endpoint
      const result = db.run('DELETE FROM response_times WHERE endpoint_id = ?', [id]);
      
      logger.info(`Deleted ${result.changes} heartbeat records for endpoint ID: ${id}`, 'DATA_MANAGEMENT');
      
      return { 
        success: true, 
        deletedCount: result.changes,
        message: `Deleted ${result.changes} heartbeat records` 
      };
    })
    .delete('/endpoints/:id/outages', async ({ params }) => {
      const { id } = params;
      
      // Since outages are calculated from response_times, deleting response_times clears outage history
      const result = db.run('DELETE FROM response_times WHERE endpoint_id = ?', [id]);
      
      logger.info(`Deleted outage history (${result.changes} response records) for endpoint ID: ${id}`, 'DATA_MANAGEMENT');
      
      return { 
        success: true, 
        deletedCount: result.changes,
        message: `Deleted outage history (${result.changes} records)` 
      };
    })
    .post('/endpoints', requireRole('admin')(async ({ body, set }: any) => {
      try {
        logger.debug(`Received POST /api/endpoints`, 'ENDPOINT');

        // Log potential security issues for monitoring
        logger.debug(`Body received for validation: ${JSON.stringify(body)}`, 'SECURITY');

        // Comprehensive validation using our security-focused validation system
        const validation = validateEndpoint(body);
        if (!validation.isValid) {
          set.status = 400;
          logger.warn(`Endpoint validation failed: ${validation.error}`, 'SECURITY');
          return { error: validation.error };
        }

        const sanitizedData = validation.sanitizedValue!;
        logger.info(`Endpoint validation passed for: ${sanitizedData.name || sanitizedData.url}`, 'SECURITY');

        // Insert the sanitized and validated data
        const result = db.run(
          `INSERT INTO endpoints (
            url, name, type, status, heartbeat_interval, retries, upside_down_mode, paused,
            http_method, http_headers, http_body, ok_http_statuses, check_cert_expiry, cert_expiry_threshold, keyword_search,
            client_cert_enabled, client_cert_public_key, client_cert_private_key, client_cert_ca,
            tcp_port, kafka_topic, kafka_message, kafka_config
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sanitizedData.url,
            sanitizedData.name || sanitizedData.url,
            sanitizedData.type,
            'pending',
            sanitizedData.heartbeat_interval || 60,
            sanitizedData.retries || 3,
            sanitizedData.upside_down_mode || false,
            false, // paused
            sanitizedData.http_method || 'GET',
            sanitizedData.http_headers ? JSON.stringify(sanitizedData.http_headers) : null,
            sanitizedData.http_body || null,
            sanitizedData.ok_http_statuses ? JSON.stringify(sanitizedData.ok_http_statuses) : null,
            sanitizedData.check_cert_expiry || false,
            sanitizedData.cert_expiry_threshold || 30,
            sanitizedData.keyword_search || null,
            sanitizedData.client_cert_enabled || false,
            sanitizedData.client_cert_public_key || null,
            sanitizedData.client_cert_private_key || null,
            sanitizedData.client_cert_ca || null,
            sanitizedData.tcp_port ?? null,
            sanitizedData.kafka_topic ?? null,
            sanitizedData.kafka_message ?? null,
            sanitizedData.kafka_config ? JSON.stringify(sanitizedData.kafka_config) : null
          ]
        );

        logger.info(`Created new endpoint "${sanitizedData.name || sanitizedData.url}" (ID: ${result.lastInsertRowid}) of type ${sanitizedData.type}`, 'ENDPOINT');

        // Start monitoring for the new endpoint immediately (hot-reload)
        const newEndpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(result.lastInsertRowid) as Endpoint | null;
        if (newEndpoint) {
          logger.info(`Starting monitoring for new endpoint "${newEndpoint.name}" (ID: ${newEndpoint.id})`, 'MONITORING');
          monitoringService.startEndpointMonitoring(newEndpoint);
          monitoringService.startCertificateMonitoring(newEndpoint);

          // Return the complete endpoint object with proper formatting (same as GET endpoint)
          const fullEndpoint = {
            ...newEndpoint,
            ok_http_statuses: newEndpoint.ok_http_statuses ? JSON.parse(newEndpoint.ok_http_statuses) : [],
            http_headers: newEndpoint.http_headers ? JSON.parse(newEndpoint.http_headers) : null,
            kafka_config: newEndpoint.kafka_config ? JSON.parse(newEndpoint.kafka_config) : null,
            // Properly convert SQLite integer values to booleans
            paused: Boolean(newEndpoint.paused),
            upside_down_mode: Boolean(newEndpoint.upside_down_mode),
            check_cert_expiry: Boolean(newEndpoint.check_cert_expiry),
            client_cert_enabled: Boolean(newEndpoint.client_cert_enabled),
            kafka_consumer_read_single: Boolean(newEndpoint.kafka_consumer_read_single),
            kafka_consumer_auto_commit: Boolean(newEndpoint.kafka_consumer_auto_commit),
            current_response: 0, // No response time yet
            avg_response_24h: 0,
            uptime_24h: 0,
            uptime_30d: 0,
            uptime_1y: 0,
            cert_expires_in: newEndpoint.cert_expires_in,
            cert_expiry_date: newEndpoint.cert_expiry_date,
          };
          
          return fullEndpoint;
        }

        // Fallback if we can't retrieve the new endpoint
        return { 
          id: result.lastInsertRowid, 
          url: sanitizedData.url, 
          name: sanitizedData.name || sanitizedData.url, 
          type: sanitizedData.type,
          status: 'pending' 
        };
      } catch (error) {
        logger.error(`Failed to create endpoint: ${error}`, 'ENDPOINT');
        set.status = 500;
        return { error: 'Failed to create endpoint: ' + (error instanceof Error ? error.message : 'Unknown error') };
      }
    }), {
      body: t.Object({
        url: t.String({ minLength: 1 }),
        name: t.Optional(t.String()),
        type: t.Union([
          t.Literal('http'),
          t.Literal('tcp'),
          t.Literal('kafka')
        ])
      }, { additionalProperties: true })
    })
    .put('/endpoints/:id', requireRole('admin')(async ({ params, body, set }: any) => {
      try {
        const { id } = params;
        
        logger.debug(`Received PUT /api/endpoints/${id}`, 'ENDPOINT');
        
        // Check if endpoint exists
        const existingEndpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as any;
        if (!existingEndpoint) {
          set.status = 404;
          return { error: 'Endpoint not found' };
        }

        // Log potential security issues for monitoring
        logger.debug(`Body received for validation: ${JSON.stringify(body)}`, 'SECURITY');

        // Comprehensive validation using our security-focused validation system
        const validation = validateEndpoint(body);
        if (!validation.isValid) {
          set.status = 400;
          logger.warn(`Endpoint validation failed for update: ${validation.error}`, 'SECURITY');
          return { error: validation.error };
        }

        const sanitizedData = validation.sanitizedValue!;
        logger.info(`Endpoint validation passed for update: ${sanitizedData.name || sanitizedData.url}`, 'SECURITY');

        // Update the endpoint with sanitized and validated data
        db.run(
          `UPDATE endpoints SET 
            name = ?, url = ?, type = ?, heartbeat_interval = ?, retries = ?, upside_down_mode = ?,
            http_method = ?, http_headers = ?, http_body = ?, ok_http_statuses = ?, check_cert_expiry = ?, cert_expiry_threshold = ?, keyword_search = ?,
            client_cert_enabled = ?, client_cert_public_key = ?, client_cert_private_key = ?, client_cert_ca = ?,
            tcp_port = ?, kafka_topic = ?, kafka_message = ?, kafka_config = ?, kafka_consumer_read_single = ?, kafka_consumer_auto_commit = ?
          WHERE id = ?`,
          [
            sanitizedData.name,
            sanitizedData.url,
            sanitizedData.type,
            sanitizedData.heartbeat_interval,
            sanitizedData.retries,
            sanitizedData.upside_down_mode,
            sanitizedData.http_method || 'GET',
            sanitizedData.http_headers ? JSON.stringify(sanitizedData.http_headers) : null,
            sanitizedData.http_body || null,
            sanitizedData.ok_http_statuses ? JSON.stringify(sanitizedData.ok_http_statuses) : null,
            sanitizedData.check_cert_expiry || false,
            sanitizedData.cert_expiry_threshold || 30,
            sanitizedData.keyword_search || null,
            sanitizedData.client_cert_enabled || false,
            sanitizedData.client_cert_public_key || null,
            sanitizedData.client_cert_private_key || null,
            sanitizedData.client_cert_ca || null,
            sanitizedData.tcp_port,
            sanitizedData.kafka_topic,
            sanitizedData.kafka_message,
            sanitizedData.kafka_config ? JSON.stringify(sanitizedData.kafka_config) : null,
            sanitizedData.kafka_consumer_read_single ?? null,
            sanitizedData.kafka_consumer_auto_commit ?? null,
            id
          ]
        );

        logger.info(`Updated endpoint "${sanitizedData.name}" (ID: ${id}) of type ${sanitizedData.type}`, 'ENDPOINT');

        // Restart monitoring with new configuration (hot-reload)
        monitoringService.restartEndpointMonitoring(parseInt(id));

        return { 
          id, 
          name: sanitizedData.name, 
          url: sanitizedData.url 
        };
      } catch (error) {
        logger.error(`Failed to update endpoint: ${error}`, 'ENDPOINT');
        set.status = 500;
        return { error: 'Failed to update endpoint: ' + (error instanceof Error ? error.message : 'Unknown error') };
      }
    }), {
      body: t.Object({
        url: t.String({ minLength: 1 }),
        name: t.Optional(t.String()),
        type: t.Union([
          t.Literal('http'),
          t.Literal('tcp'),
          t.Literal('kafka')
        ])
      }, { additionalProperties: true })
    })
    .delete('/endpoints/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;
      
      // Get endpoint name before deletion for logging
      const endpoint = db.query('SELECT name FROM endpoints WHERE id = ?').get(id) as any;
      const endpointName = endpoint?.name || `ID: ${id}`;
      
      // Stop monitoring for this endpoint immediately (hot-reload)
      monitoringService.stopEndpointMonitoring(parseInt(id));
      logger.info(`Stopped monitoring for deleted endpoint "${endpointName}" (ID: ${id})`, 'MONITORING');
      
      db.run('DELETE FROM endpoints WHERE id = ?', [id]);
      return { id };
    }))
    .post('/endpoints/:id/toggle-pause', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;
      
      // Get current pause status
      const endpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as any;
      if (!endpoint) {
        throw new Error('Endpoint not found');
      }
      
      const newPausedState = !endpoint.paused;
      
      // Update pause status in database
      db.run('UPDATE endpoints SET paused = ? WHERE id = ?', [newPausedState, id]);
      
      // Apply pause/unpause immediately (hot-reload)
      if (newPausedState) {
        // Pausing the endpoint - stop monitoring
        monitoringService.stopEndpointMonitoring(parseInt(id));
        logger.info(`Paused monitoring for endpoint "${endpoint.name}" (ID: ${id})`, 'MONITORING');
      } else {
        // Unpausing the endpoint - restart monitoring with updated config
        monitoringService.restartEndpointMonitoring(parseInt(id));
        logger.info(`Resumed monitoring for endpoint "${endpoint.name}" (ID: ${id})`, 'MONITORING');
      }
      
      return { id, paused: newPausedState };
    }));
}
