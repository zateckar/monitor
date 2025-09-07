import { Elysia, t } from 'elysia';
import type {
  InstanceRegistration,
  HeartbeatPayload,
  MonitoringResult,
  SyncConfiguration,
  Endpoint,
  MonitoringInstance
} from '../types';
import { ServiceContainer } from '../services/service-container';
import jwt from 'jsonwebtoken';
import { createSuccessResponse, createErrorResponse } from '../utils/auth-constants';

/**
 * Creates distributed monitoring sync routes
 * @param services Service container with all required dependencies
 * @returns Elysia route handler for distributed monitoring sync
 */
export function createSyncRoutes(services: ServiceContainer) {
  const { db, syncService, configService, logger, requireAuth, requireRole } = services;
  console.log('=== createSyncRoutes called ===');
  console.log('requireAuth:', typeof requireAuth);
  console.log('requireRole:', typeof requireRole);
  console.log('requireRole value:', requireRole);
  // Get shared secret for registration validation
  const getSharedSecret = (): string | undefined => {
    return configService.getSharedSecret();
  };
  // JWT secret for sync authentication
  const getJWTSecret = (): string => {
    try {
      const existing = db.query('SELECT value FROM instance_config WHERE key = ?').get('jwtSecret') as any;
      if (existing?.value) {
        return existing.value;
      }
    } catch (error) {
      // Fall back to a default - this should be properly handled
      logger.warn('No JWT secret found, using fallback', 'SYNC');
    }
    return 'fallback-secret-change-me';
  };

  // Sync-specific authentication middleware for inter-instance communication
  const syncAuthMiddleware = () => {
    return (app: any) => app.derive(async ({ headers, set }: any) => {
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        set.status = 401;
        throw new Error('Missing or invalid authorization header');
      }

      const token = authHeader.substring(7);
      try {
        const payload = jwt.verify(token, getJWTSecret()) as any;
        return { instanceId: payload.instanceId };
      } catch (error) {
        set.status = 401;
        throw new Error('Invalid or expired token');
      }
    });
  };

  return new Elysia({ prefix: '/api/sync' })
    .onBeforeHandle(({ request, set }) => {
      // Limit request body size to 10MB for sync routes
      const contentLength = request.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
        set.status = 413;
        return { success: false, error: 'Request body too large' };
      }
    })

    // === Frontend Instance Access ===

    /**
     * Frontend-compatible endpoint for instance data (uses cookie authentication)
     * @returns List of registered instances for frontend consumption
     */
    .get('/instances/frontend', requireRole('admin')(async ({ set }: any) => {
      try {
        logger.info('Frontend instances endpoint called', 'SYNC');

        if (!configService.isPrimary()) {
          logger.warn('Instance management requested but not primary instance', 'SYNC');
          set.status = 403;
          return createErrorResponse('Instance management only available on primary instance');
        }

        const instances = await syncService.getRegisteredInstances();
        logger.info(`Frontend instances requested - found ${instances.length} registered instances`, 'SYNC');
        return createSuccessResponse(instances);
      } catch (error) {
        logger.error(`Failed to get instances for frontend: ${error}`, 'SYNC');
        set.status = 500;
        return createErrorResponse(error instanceof Error ? error.message : 'Failed to get instances');
      }
    }))

    // === Instance Registration ===

    /**
     * Register a new instance with the primary (primary instance only)
     * @param body - Instance registration data including shared secret
     * @returns Registration token and instance ID
     */
    .post('/register', async ({ body, set }) => {
      try {
        if (!configService.isPrimary()) {
          set.status = 403;
          return { success: false, error: 'Registration only available on primary instance' };
        }

        const registration = body as InstanceRegistration & { sharedSecret: string };

        // Validate shared secret
        const expectedSecret = getSharedSecret();
        if (!expectedSecret) {
          set.status = 500;
          return { success: false, error: 'Shared secret not configured on primary instance' };
        }

        if (!registration.sharedSecret || registration.sharedSecret !== expectedSecret) {
          set.status = 401;
          return { success: false, error: 'Invalid shared secret' };
        }

        // Remove sharedSecret from registration data before processing
        const { sharedSecret, ...cleanRegistration } = registration;

        const token = await syncService.registerInstance(cleanRegistration);
        logger.info(`Instance ${cleanRegistration.instanceId} registered successfully`, 'SYNC');
        return { success: true, data: { token, instanceId: cleanRegistration.instanceId } };
      } catch (error) {
        logger.error(`Instance registration failed: ${error}`, 'SYNC');
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : 'Registration failed' };
      }
    }, {
      body: t.Object({
        instanceId: t.String(),
        instanceName: t.String(),
        location: t.Optional(t.String()),
        version: t.String(),
        capabilities: t.Array(t.String()),
        failoverOrder: t.Number(),
        publicEndpoint: t.Optional(t.String()),
        sharedSecret: t.String(),
        systemInfo: t.Object({
          platform: t.String(),
          arch: t.String(),
          nodeVersion: t.String(),
          memory: t.Number(),
          cpu: t.Number(),
          uptime: t.Number()
        })
      })
    })

    .use(syncAuthMiddleware())

    // === Heartbeat Processing ===

    /**
     * Process heartbeat from dependent instance (primary instance only)
     * @param body - Heartbeat payload with monitoring results and system metrics
     * @returns Heartbeat processing confirmation with timestamp
     */
    .put('/heartbeat', async ({ body, set }) => {
      try {
        if (!configService.isPrimary()) {
          set.status = 403;
          return { success: false, error: 'Heartbeat processing only available on primary instance' };
        }

        const heartbeat = body as HeartbeatPayload;
        logger.debug(`Received heartbeat from ${heartbeat.instanceId} with ${heartbeat.monitoringResults.length} results`, 'SYNC');
        await syncService.processHeartbeat(heartbeat);
        const timestamp = new Date().toISOString();
        return { success: true, data: { timestamp } };
      } catch (error) {
        logger.error(`Heartbeat processing failed: ${error}`, 'SYNC');
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : 'Heartbeat processing failed' };
      }
    }, {
      body: t.Object({
        instanceId: t.String(),
        timestamp: t.String(),
        status: t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('failing')]),
        uptime: t.Number(),
        monitoringResults: t.Array(t.Object({
          endpointId: t.Number(),
          instanceId: t.String(),
          timestamp: t.String(),
          isOk: t.Boolean(),
          responseTime: t.Number(),
          status: t.Union([t.Literal('UP'), t.Literal('DOWN')]),
          failureReason: t.Optional(t.String()),
          location: t.String(),
          checkType: t.Union([t.Literal('http'), t.Literal('ping'), t.Literal('tcp'), t.Literal('kafka_producer'), t.Literal('kafka_consumer')]),
          metadata: t.Optional(t.Record(t.String(), t.Unknown()))
        })),
        systemMetrics: t.Object({
          cpuUsage: t.Number(),
          memoryUsage: t.Number(),
          diskUsage: t.Number(),
          activeEndpoints: t.Number()
        }),
        connectionStatus: t.Object({
          primaryReachable: t.Boolean(),
          lastSyncSuccess: t.Optional(t.String()),
          syncErrors: t.Number(),
          latency: t.Optional(t.Number())
        })
      })
    })

    /**
     * Get endpoints configuration for sync (primary instance only)
     * @returns Endpoints configuration for dependent instances
     */
    .get('/endpoints', async ({ set }) => {
      try {
        if (!configService.isPrimary()) {
          set.status = 403;
          return { success: false, error: 'Endpoint sync only available on primary instance' };
        }

        const config = await syncService.getEndpointsForSync();
        return { success: true, data: config };
      } catch (error) {
        logger.error(`Failed to get endpoints for sync: ${error}`, 'SYNC');
        set.status = 500;
        return { success: false, error: error instanceof Error ? error.message : 'Failed to get endpoints' };
      }
    })

    /**
     * Get registered instances (primary instance only)
     * @returns List of registered monitoring instances
     */
    .get('/instances', async ({ set, request }) => {
      try {
        logger.info('Sync instances endpoint called', 'SYNC');

        if (!configService.isPrimary()) {
          logger.warn('Instance management requested but not primary instance', 'SYNC');
          set.status = 403;
          return { success: false, error: 'Instance management only available on primary instance' };
        }

        const instances = await syncService.getRegisteredInstances();
        logger.info(`Instances requested - found ${instances.length} registered instances`, 'SYNC');
        return { success: true, data: instances };
      } catch (error) {
        logger.error(`Failed to get instances: ${error}`, 'SYNC');
        set.status = 500;
        return { success: false, error: error instanceof Error ? error.message : 'Failed to get instances' };
      }
    })

    /**
     * Unregister an instance (primary instance only)
     * @param params.id - Instance ID to unregister
     * @returns Success confirmation
     */
    .delete('/instances/:id', async ({ params, set }) => {
      try {
        if (!configService.isPrimary()) {
          set.status = 403;
          return { success: false, error: 'Instance management only available on primary instance' };
        }

        await syncService.unregisterInstance(params.id);
        logger.info(`Instance ${params.id} unregistered`, 'SYNC');
        return { success: true, message: 'Instance unregistered successfully' };
      } catch (error) {
        logger.error(`Failed to unregister instance: ${error}`, 'SYNC');
        set.status = 500;
        return { success: false, error: error instanceof Error ? error.message : 'Failed to unregister instance' };
      }
    })

    /**
     * Get failover order (primary instance only)
     * @returns Current failover order configuration
     */
    .get('/failover-order', async ({ set }) => {
      try {
        if (!configService.isPrimary()) {
          set.status = 403;
          return { success: false, error: 'Failover order only available on primary instance' };
        }

        const order = await syncService.getFailoverOrder();
        return { success: true, data: order };
      } catch (error) {
        logger.error(`Failed to get failover order: ${error}`, 'SYNC');
        set.status = 500;
        return { success: false, error: error instanceof Error ? error.message : 'Failed to get failover order' };
      }
    })

    /**
     * Update failover order (primary instance only)
     * @param body.instanceOrders - Array of instance ID and order pairs
     * @returns Success confirmation
     */
    .put('/failover-order', async ({ body, set }) => {
      try {
        if (!configService.isPrimary()) {
          set.status = 403;
          return { success: false, error: 'Failover order management only available on primary instance' };
        }

        const { instanceOrders } = body as { instanceOrders: { instanceId: string; order: number }[] };

        if (!Array.isArray(instanceOrders)) {
          set.status = 400;
          return { success: false, error: 'Invalid request format' };
        }

        // Update failover orders in database
        for (const { instanceId, order } of instanceOrders) {
          db.run(
            'UPDATE monitoring_instances SET failover_order = ? WHERE instance_id = ?',
            [order, instanceId]
          );
        }

        logger.info(`Updated failover order for ${instanceOrders.length} instances`, 'SYNC');

        return { success: true, message: 'Failover order updated successfully' };
      } catch (error) {
        logger.error(`Failed to update failover order: ${error}`, 'SYNC');
        set.status = 500;
        return { success: false, error: 'Failed to update failover order' };
      }
    }, {
      body: t.Object({
        instanceOrders: t.Array(t.Object({
          instanceId: t.String(),
          order: t.Number()
        }))
      })
    })


    /**
     * Get comprehensive instance health data (primary instance only)
     * @returns Detailed health information for all registered instances
     */
    .get('/instances/health', async ({ set }) => {
      try {
        if (!configService.isPrimary()) {
          set.status = 403;
          return { success: false, error: 'Instance health monitoring only available on primary instance' };
        }

        // Get all instances with their latest data
        const instances = db.prepare(`
          SELECT
            mi.*,
            ic.value as connection_info_raw,
            sc.value as system_info_raw
          FROM monitoring_instances mi
          LEFT JOIN instance_config ic ON ic.key = 'connection_' || mi.instance_id
          LEFT JOIN instance_config sc ON sc.key = 'system_' || mi.instance_id
          ORDER BY mi.failover_order ASC
        `).all() as any[];

        // Parse and enhance the instance data
        const enrichedInstances = instances.map(instance => {
          let connection_info = null;
          let system_info = null;

          try {
            if (instance.connection_info_raw) {
              connection_info = JSON.parse(instance.connection_info_raw);
            }
          } catch (e) {
            logger.warn(`Failed to parse connection info for instance ${instance.instance_id}: ${e}`, 'SYNC');
          }

          try {
            if (instance.system_info_raw) {
              system_info = JSON.parse(instance.system_info_raw);
            }
          } catch (e) {
            logger.warn(`Failed to parse system info for instance ${instance.instance_id}: ${e}`, 'SYNC');
          }

          return {
            id: instance.id,
            instance_id: instance.instance_id,
            instance_name: instance.instance_name,
            location: instance.location,
            sync_url: instance.sync_url,
            failover_order: instance.failover_order,
            last_heartbeat: instance.last_heartbeat,
            status: instance.status,
            capabilities: instance.capabilities ? JSON.parse(instance.capabilities) : [],
            system_info,
            connection_info,
            created_at: instance.created_at,
            updated_at: instance.updated_at
          };
        });

        return {
          success: true,
          data: {
            instances: enrichedInstances,
            timestamp: new Date().toISOString()
          }
        };
      } catch (error) {
        logger.error(`Failed to get instance health data: ${error}`, 'SYNC');
        set.status = 500;
        return { success: false, error: 'Failed to get instance health data' };
      }
    });
}