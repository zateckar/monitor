import { Elysia } from 'elysia';
import { Database } from 'bun:sqlite';
import type { Endpoint } from '../types';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';
import { MonitoringService } from '../services/monitoring';
import { validateEndpoint } from '../utils/validation';
import { calculateGapAwareUptime } from '../utils/uptime';
import { formatDuration } from '../utils/formatting';

export function createEndpointsRoutes(
  db: Database,
  authService: AuthService, 
  logger: LoggerService,
  monitoringService: MonitoringService,
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
            paused: Boolean(endpoint.paused),
            upside_down_mode: Boolean(endpoint.upside_down_mode),
            check_cert_expiry: Boolean(endpoint.check_cert_expiry),
            client_cert_enabled: Boolean(endpoint.client_cert_enabled),
            current_response: lastResponse?.response_time || 0,
            avg_response_24h: stats24h?.avg_response || 0,
            uptime_24h: stats24h?.uptime || 0,
            uptime_30d,
            uptime_1y,
            cert_expires_in: null,
            cert_expiry_date: null,
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

      return {
        avg_response: stats?.avg_response || 0,
        uptime: stats?.uptime || 0,
        monitoring_coverage: stats?.monitoring_coverage || 0,
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
        `SELECT status, created_at, response_time
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
      
      // Process status changes in reverse chronological order to build outage periods
      for (let i = statusChanges.length - 1; i >= 0; i--) {
        const change = statusChanges[i];
        
        if (change.status === 'DOWN' && !currentOutageStart) {
          // Start of an outage
          currentOutageStart = change.created_at;
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
            reason: 'Service check failed' // Default reason as we don't track specific reasons yet
          });
          
          currentOutageStart = null;
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
          reason: 'Service check failed'
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
    .post('/endpoints', requireRole('admin')(async ({ body, request, set }: any) => {
      try {
        logger.debug(`Received POST /api/endpoints`, 'ENDPOINT');
        logger.debug(`Request Content-Type: ${request.headers.get('content-type')}`, 'ENDPOINT');
        
        // Ensure body exists and is an object
        if (!body || typeof body !== 'object') {
          set.status = 400;
          logger.error(`Invalid request body - body: ${body}, type: ${typeof body}`, 'ENDPOINT');
          return { error: 'Invalid request body' };
        }

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
        }

        return { 
          id: result.lastInsertRowid, 
          url: sanitizedData.url, 
          name: sanitizedData.name || sanitizedData.url, 
          status: 'pending' 
        };
      } catch (error) {
        logger.error(`Failed to create endpoint: ${error}`, 'ENDPOINT');
        set.status = 500;
        return { error: 'Failed to create endpoint: ' + (error instanceof Error ? error.message : 'Unknown error') };
      }
    }))
    .put('/endpoints/:id', requireRole('admin')(async ({ params, body, request, set }: any) => {
      try {
        const { id } = params;
        
        logger.debug(`Received PUT /api/endpoints/${id}`, 'ENDPOINT');
        logger.debug(`Request Content-Type: ${request.headers.get('content-type')}`, 'ENDPOINT');
        
        // Check if endpoint exists
        const existingEndpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as any;
        if (!existingEndpoint) {
          set.status = 404;
          return { error: 'Endpoint not found' };
        }

        // Ensure body exists and is an object
        if (!body || typeof body !== 'object') {
          set.status = 400;
          logger.error(`Invalid request body - body: ${body}, type: ${typeof body}`, 'ENDPOINT');
          return { error: 'Invalid request body' };
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
            tcp_port = ?, kafka_topic = ?, kafka_message = ?, kafka_config = ?
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
    }))
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
