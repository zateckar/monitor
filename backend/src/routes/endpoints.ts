import { Elysia, t } from 'elysia';
import type { Endpoint } from '../types';
import type { IMonitoringService } from '../types/monitoring';
import { ServiceContainer } from '../services/service-container';
import { validateEndpoint } from '../utils/validation';
import { calculateGapAwareUptime } from '../utils/uptime';
import { formatDuration } from '../utils/formatting';
import { calculateResponseTimeStatistics } from '../utils/statistics';
import { createSuccessResponse, createErrorResponse } from '../utils/auth-constants';

/**
 * Creates endpoint management routes
 * @param services Service container with all required dependencies
 * @returns Elysia route handler for endpoint management
 */
export function createEndpointsRoutes(services: ServiceContainer) {
  const {
    db,
    logger,
    monitoringService,
    domainInfoService,
    certificateService,
    requireRole
  } = services;
  
  return new Elysia({ prefix: '/api' })
    .onBeforeHandle(({ request, set }) => {
      // Limit request body size to 5MB for endpoint routes
      const contentLength = request.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
        set.status = 413;
        return { success: false, error: 'Request body too large' };
      }
    })

    // === Endpoint Retrieval ===

    /**
     * Get all endpoints with statistics and uptime data
     * @returns Array of endpoints with calculated statistics and uptime metrics
     */
    .get('/endpoints', requireRole('user')(async () => {
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
            ok_http_statuses: endpoint.ok_http_statuses && endpoint.ok_http_statuses.trim() !== '' ? JSON.parse(endpoint.ok_http_statuses) : [],
            http_headers: endpoint.http_headers && endpoint.http_headers.trim() !== '' ? JSON.parse(endpoint.http_headers) : null,
            kafka_config: endpoint.kafka_config && endpoint.kafka_config.trim() !== '' ? JSON.parse(endpoint.kafka_config) : null,
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
      return createSuccessResponse(endpointsWithStats);
    }))

    // === Endpoint Creation ===

    /**
     * Create a new endpoint for monitoring
     * @param body - Endpoint configuration data
     * @returns Created endpoint with statistics
     */
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
          return createErrorResponse(validation.error || 'Validation failed');
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

          return createSuccessResponse(fullEndpoint);
        }

        // Fallback if we can't retrieve the new endpoint
        return createSuccessResponse({
          id: result.lastInsertRowid,
          url: sanitizedData.url,
          name: sanitizedData.name || sanitizedData.url,
          type: sanitizedData.type,
          status: 'pending'
        });
      } catch (error) {
        logger.error(`Failed to create endpoint: ${error}`, 'ENDPOINT');
        set.status = 500;
        return createErrorResponse('Failed to create endpoint: ' + (error instanceof Error ? error.message : 'Unknown error'));
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

    // === Endpoint Modification ===

    /**
     * Update an existing endpoint configuration
     * @param params.id - Endpoint ID to update
     * @param body - Updated endpoint configuration
     * @returns Updated endpoint data
     */
    .put('/endpoints/:id', requireRole('admin')(async ({ params, body, set }: any) => {
      try {
        const { id } = params;
        
        logger.debug(`Received PUT /api/endpoints/${id}`, 'ENDPOINT');
        
        // Check if endpoint exists
        const existingEndpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as any;
        if (!existingEndpoint) {
          set.status = 404;
          return createErrorResponse('Endpoint not found');
        }

        // Log potential security issues for monitoring
        logger.debug(`Body received for validation: ${JSON.stringify(body)}`, 'SECURITY');

        // Comprehensive validation using our security-focused validation system
        const validation = validateEndpoint(body);
        if (!validation.isValid) {
          set.status = 400;
          logger.warn(`Endpoint validation failed for update: ${validation.error}`, 'SECURITY');
          return createErrorResponse(validation.error || 'Validation failed');
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

        return createSuccessResponse({
          id,
          name: sanitizedData.name,
          url: sanitizedData.url
        });
      } catch (error) {
        logger.error(`Failed to update endpoint: ${error}`, 'ENDPOINT');
        set.status = 500;
        return createErrorResponse('Failed to update endpoint: ' + (error instanceof Error ? error.message : 'Unknown error'));
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

    // === Endpoint Deletion ===

    /**
     * Delete an endpoint and stop its monitoring
     * @param params.id - Endpoint ID to delete
     * @returns Success confirmation
     */
    .delete('/endpoints/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;
      
      // Get endpoint name before deletion for logging
      const endpoint = db.query('SELECT name FROM endpoints WHERE id = ?').get(id) as any;
      const endpointName = endpoint?.name || `ID: ${id}`;
      
      // Stop monitoring for this endpoint immediately (hot-reload)
      monitoringService.stopEndpointMonitoring(parseInt(id));
      logger.info(`Stopped monitoring for deleted endpoint "${endpointName}" (ID: ${id})`, 'MONITORING');
      
      db.run('DELETE FROM endpoints WHERE id = ?', [id]);
      return createSuccessResponse({ id });
    }))

    // === Endpoint Control ===

    /**
     * Toggle pause/unpause status for an endpoint
     * @param params.id - Endpoint ID to toggle
     * @returns Updated pause status
     */
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

      return createSuccessResponse({ id, paused: newPausedState });
    }))

    /**
     * Get outages for an endpoint
     * @param params.id - Endpoint ID
     * @param query.limit - Maximum number of outages to return
     * @returns Array of outage records
     */
    .get('/endpoints/:id/outages', requireRole('user')(async ({ params, query }: any) => {
      const { id } = params;
      const limit = parseInt(query.limit) || 50;

      const outages = db.query(`
        SELECT
          started_at,
          ended_at,
          CASE
            WHEN ended_at IS NULL THEN NULL
            ELSE ROUND((julianday(ended_at) - julianday(started_at)) * 86400)
          END as duration_ms,
          CASE
            WHEN ended_at IS NULL THEN 'Ongoing'
            ELSE printf('%d seconds', ROUND((julianday(ended_at) - julianday(started_at)) * 86400))
          END as duration_text,
          reason
        FROM outages
        WHERE endpoint_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `).all(id, limit) as any[];

      return createSuccessResponse(outages);
    }), {
      params: t.Object({
        id: t.String()
      }),
      query: t.Object({
        limit: t.Optional(t.String())
      })
    })

    /**
     * Delete all outages for an endpoint
     * @param params.id - Endpoint ID
     * @returns Success confirmation
     */
    .delete('/endpoints/:id/outages', requireRole('admin')(async ({ params, set }: any) => {
      const { id } = params;

      // Check if endpoint exists
      const endpoint = db.query('SELECT name FROM endpoints WHERE id = ?').get(id) as any;
      if (!endpoint) {
        set.status = 404;
        return createErrorResponse('Endpoint not found');
      }

      // Delete all outages for this endpoint
      db.run('DELETE FROM outages WHERE endpoint_id = ?', [id]);

      logger.info(`Cleared all outage data for endpoint "${endpoint.name}" (ID: ${id})`, 'ENDPOINT');

      return createSuccessResponse({ message: 'Outage data cleared successfully' });
    }), {
      params: t.Object({
        id: t.String()
      })
    })

    /**
     * Get certificate chain for an endpoint
     * @param params.id - Endpoint ID
     * @returns Certificate chain information
     */
    .get('/endpoints/:id/certificate-chain', requireRole('user')(async ({ params, set }: any) => {
      const { id } = params;

      const endpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as Endpoint | null;
      if (!endpoint) {
        set.status = 404;
        return createErrorResponse('Endpoint not found');
      }

      if (endpoint.type !== 'http') {
        set.status = 400;
        return createErrorResponse('Certificate chain is only available for HTTP endpoints');
      }

      try {
        const result = await certificateService.getCertificateChain(endpoint.url);
        if (result.success) {
          return createSuccessResponse(result.result);
        } else {
          set.status = 400;
          return createErrorResponse(result.error.details);
        }
      } catch (error) {
        logger.error(`Failed to get certificate chain for endpoint ${id}: ${error}`, 'ENDPOINT');
        set.status = 500;
        return createErrorResponse('Failed to retrieve certificate chain');
      }
    }), {
      params: t.Object({
        id: t.String()
      })
    })

    /**
     * Get domain information for an endpoint
     * @param params.id - Endpoint ID
     * @returns Domain registration information
     */
    .get('/endpoints/:id/domain-info', requireRole('user')(async ({ params, set }: any) => {
      const { id } = params;

      const endpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as Endpoint | null;
      if (!endpoint) {
        set.status = 404;
        return createErrorResponse('Endpoint not found');
      }

      try {
        const result = await domainInfoService.getDomainInfo(endpoint.url);
        if (result.success) {
          return createSuccessResponse(result.result);
        } else {
          set.status = 400;
          return createErrorResponse(result.error.details);
        }
      } catch (error) {
        logger.error(`Failed to get domain info for endpoint ${id}: ${error}`, 'ENDPOINT');
        set.status = 500;
        return createErrorResponse('Failed to retrieve domain information');
      }
    }), {
      params: t.Object({
        id: t.String()
      })
    })

    /**
     * Get enhanced domain information for an endpoint
     * @param params.id - Endpoint ID
     * @returns Enhanced domain registration information with additional RDAP data
     */
    .get('/endpoints/:id/enhanced-domain-info', requireRole('user')(async ({ params, set }: any) => {
      const { id } = params;

      const endpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as Endpoint | null;
      if (!endpoint) {
        set.status = 404;
        return createErrorResponse('Endpoint not found');
      }

      try {
        const result = await domainInfoService.getEnhancedDomainInfo(endpoint.url);
        if (result.success) {
          return createSuccessResponse(result.result);
        } else {
          set.status = 400;
          return createErrorResponse(result.error.details);
        }
      } catch (error) {
        logger.error(`Failed to get enhanced domain info for endpoint ${id}: ${error}`, 'ENDPOINT');
        set.status = 500;
        return createErrorResponse('Failed to retrieve enhanced domain information');
      }
    }), {
      params: t.Object({
        id: t.String()
      })
    })

    /**
     * Get statistics for an endpoint
     * @param params.id - Endpoint ID
     * @returns Comprehensive endpoint statistics
     */
    .get('/endpoints/:id/stats', requireRole('user')(async ({ params, query, set }: any) => {
      const { id } = params;
      const range = query.range || '24h'; // Default to 24h

      const endpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as Endpoint | null;
      if (!endpoint) {
        set.status = 404;
        return createErrorResponse('Endpoint not found');
      }

      try {
        // Determine time period for query
        const timePeriods: { [key: string]: string } = {
          '3h': '3 hours',
          '6h': '6 hours',
          '24h': '1 day',
          '1w': '7 days'
        };
        const period = timePeriods[range] || '1 day';

        // Get uptime and coverage stats
        const uptimeStats = await calculateGapAwareUptime(db, parseInt(id), endpoint.heartbeat_interval || 60, period);

        // Get response time raw data for statistical analysis
        const responseTimes = db.query(
          `SELECT response_time FROM response_times WHERE endpoint_id = ? AND created_at >= datetime('now', '-${period}')`
        ).all(id) as any[];
        
        const responseValues = responseTimes.map(rt => rt.response_time);
        const responseStats = calculateResponseTimeStatistics(responseValues);

        const stats = {
          avg_response: uptimeStats.avg_response,
          uptime: uptimeStats.uptime,
          monitoring_coverage: uptimeStats.monitoring_coverage,
          p50: responseStats.p50,
          p90: responseStats.p90,
          p95: responseStats.p95,
          p99: responseStats.p99,
          std_dev: responseStats.std_dev,
          mad: responseStats.mad,
          min_response: responseStats.min,
          max_response: responseStats.max,
          response_count: responseValues.length
        };

        return createSuccessResponse(stats);
      } catch (error) {
        logger.error(`Failed to get stats for endpoint ${id}: ${error}`, 'ENDPOINT');
        set.status = 500;
        return createErrorResponse('Failed to retrieve endpoint statistics');
      }
    }), {
      params: t.Object({
        id: t.String()
      }),
      query: t.Object({
        range: t.Optional(t.String())
      })
    })

    /**
     * Get response times for an endpoint
     * @param params.id - Endpoint ID
     * @param query.limit - Maximum number of response times to return
     * @returns Array of response time records
     */
    .get('/endpoints/:id/response-times', requireRole('user')(async ({ params, query }: any) => {
      const { id } = params;
      const limit = parseInt(query.limit) || 100;

      const responseTimes = db.query(`
        SELECT
          response_time,
          created_at,
          status
        FROM response_times
        WHERE endpoint_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(id, limit) as any[];

      return createSuccessResponse(responseTimes);
    }), {
      params: t.Object({
        id: t.String()
      }),
      query: t.Object({
        limit: t.Optional(t.String())
      })
    })

    /**
     * Get heartbeats for an endpoint
     * @param params.id - Endpoint ID
     * @param query.limit - Maximum number of heartbeats to return
     * @returns Array of heartbeat records
     */
    .get('/endpoints/:id/heartbeats', requireRole('user')(async ({ params, query }: any) => {
      const { id } = params;
      const limit = parseInt(query.limit) || 100;

      const heartbeats = db.query(`
        SELECT
          response_time,
          created_at,
          status
        FROM response_times
        WHERE endpoint_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(id, limit) as any[];

      return createSuccessResponse(heartbeats);
    }), {
      params: t.Object({
        id: t.String()
      }),
      query: t.Object({
        limit: t.Optional(t.String())
      })
    })

    /**
     * Delete all heartbeats for an endpoint
     * @param params.id - Endpoint ID
     * @returns Success confirmation
     */
    .delete('/endpoints/:id/heartbeats', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;

      // Delete all response times for this endpoint
      db.run('DELETE FROM response_times WHERE endpoint_id = ?', [id]);

      logger.info(`Cleared all heartbeat data for endpoint ID: ${id}`, 'ENDPOINT');

      return createSuccessResponse({ message: 'Heartbeat data cleared successfully' });
    }), {
      params: t.Object({
        id: t.String()
      })
    });
}
