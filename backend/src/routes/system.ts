import { Elysia, t } from 'elysia';
import { ServiceContainer } from '../services/service-container';
import { createSuccessResponse, createErrorResponse } from '../utils/auth-constants';
import { validateUrl } from '../utils/validation';

/**
 * Creates system management routes
 * @param services Service container with all required dependencies
 * @returns Elysia route handler for system management
 */
export function createSystemRoutes(services: ServiceContainer) {
  const { db, databaseService, logger, configService, distributedMonitoringService, syncService, requireRole } = services;
  return new Elysia({ prefix: '/api' })

    // === Logging Management ===

    /**
     * Get application logs
     * @returns Array of log entries ordered by timestamp descending
     */
    .get('/system/logs', requireRole('admin')(async () => {
      const logs = db.query('SELECT * FROM application_logs ORDER BY timestamp DESC LIMIT 1000').all() as any[];
      return createSuccessResponse(logs);
    }))

    /**
     * Clear all application logs
     * @returns Success confirmation
     */
    .delete('/system/logs', requireRole('admin')(async () => {
      db.run('DELETE FROM application_logs');
      logger.info('Application logs cleared by admin', 'SYSTEM');
      return createSuccessResponse({ message: 'Application logs cleared successfully' });
    }))
    /**
       * Get current log level
       * @returns Current log level configuration
       */
    .get('/system/logs/level', requireRole('admin')(async () => {
      const level = logger.getLogLevel();
      return createSuccessResponse({ level });
    }))
    /**
     * Update log level
     * @param body.level - New log level (debug, info, warn, error)
     * @returns Updated log level
     */
    .put('/system/logs/level', requireRole('admin')(async ({ body, set }: any) => {
      const { level } = body as { level: string };
      try {
        logger.setLogLevel(level);
        logger.info(`Log level changed to: ${level}`, 'SYSTEM');
        return createSuccessResponse({ level });
      } catch (error) {
        logger.error(`Failed to set log level: ${error}`, 'SYSTEM');
        set.status = 400;
        return createErrorResponse(error instanceof Error ? error.message : 'Failed to set log level');
      }
    }), {
      body: t.Object({
        level: t.String({ minLength: 1 })
      })
    })

    // === Database Management ===

    /**
     * Get database statistics
     * @returns Database performance and size statistics
     */
    .get('/system/database/stats', requireRole('admin')(async () => {
      const stats = await databaseService.getStats();
      return createSuccessResponse(stats);
    }))
    /**
      * Perform database vacuum operation
      * @returns Vacuum operation results
      */
    .post('/system/database/vacuum', requireRole('admin')(async ({ set }: { set: any }) => {
      try {
        const result = await databaseService.vacuum();
        return createSuccessResponse(result);
      } catch (error) {
        logger.error(`Database vacuum failed: ${error}`, 'SYSTEM');
        set.status = 500;
        return createErrorResponse(error instanceof Error ? error.message : 'Database vacuum failed');
      }
    }))

    // === Distributed Monitoring Configuration ===

    /**
     * Get distributed monitoring configuration
     * @returns Current instance role, configuration, and validation status
     */
    .get('/system/distributed-config', requireRole('admin')(async () => {
      const role = configService.getInstanceRole();
      const config = configService.getConfig();
      const validation = configService.validateConfiguration();

      logger.info(`Distributed config requested - Role: ${role}, Instance: ${config.instanceName}`, 'SYSTEM');

      return createSuccessResponse({
        role,
        config,
        validation
      });
    }))
    /**
     * Update distributed monitoring configuration
     * @param body.config - Configuration object to update
     * @param body.role - New instance role (primary/dependent/standalone)
     * @returns Updated configuration and role
     */
    .put('/system/distributed-config', requireRole('admin')(async ({ body, set }: any) => {
      try {
        const { config, role } = body;

        // Validate the configuration
        const validation = configService.validateConfiguration();
        if (!validation.isValid) {
          set.status = 400;
          return createErrorResponse('Configuration validation failed', validation.errors);
        }

        // Update configuration
        await configService.updateConfig(config);

        // Handle role changes
        if (role !== configService.getInstanceRole() && distributedMonitoringService) {
          await distributedMonitoringService.switchRole(role, config.primarySyncURL);
        }

        logger.info(`Distributed configuration updated: role=${role}`, 'SYSTEM');

        return createSuccessResponse({
          config: configService.getConfig(),
          role: configService.getInstanceRole()
        });
      } catch (error) {
        logger.error(`Failed to update distributed configuration: ${error}`, 'SYSTEM');
        set.status = 500;
        return { success: false, error: error instanceof Error ? error.message : 'Failed to update distributed configuration' };
      }
    }), {
      body: t.Object({
        config: t.Object({
          instanceName: t.String(),
          instanceLocation: t.Optional(t.String()),
          primarySyncURL: t.Optional(t.String()),
          failoverOrder: t.Optional(t.Number()),
          syncInterval: t.Optional(t.Number()),
          heartbeatInterval: t.Optional(t.Number()),
          connectionTimeout: t.Optional(t.Number()),
          sharedSecret: t.Optional(t.String())
        }),
        role: t.Union([t.Literal('primary'), t.Literal('dependent'), t.Literal('standalone')])
      })
    })
    /**
     * Generate a new shared secret for instance authentication
     * @returns Generated shared secret
     */
    .post('/system/generate-shared-secret', requireRole('admin')(async ({ set }: any) => {
      try {
        if (!configService.isPrimary()) {
          set.status = 403;
          return createErrorResponse('Shared secret generation only available on primary instance');
        }

        const secret = await configService.generateSharedSecret();
        logger.info('Shared secret generated by admin', 'SYSTEM');

        return createSuccessResponse({ secret });
      } catch (error) {
        logger.error(`Failed to generate shared secret: ${error}`, 'SYSTEM');
        set.status = 500;
        return createErrorResponse(error instanceof Error ? error.message : 'Failed to generate shared secret');
      }
    }))

    // === Instance Management ===

    /**
     * Get all registered instances (primary instance only)
     * @returns List of registered monitoring instances
     */
    .get('/system/instances', requireRole('admin')(async () => {
      logger.info('Instances endpoint called', 'SYSTEM');
      if (!configService.isPrimary()) {
        logger.warn('Instance management requested but not primary instance', 'SYSTEM');
        return createErrorResponse('Instance management only available on primary instance');
      }
      const instances = await syncService.getRegisteredInstances();
      logger.info(`Found ${instances.length} registered instances`, 'SYSTEM');
      return createSuccessResponse(instances);
    }))
    /**
      * Unregister an instance
      * @param params.instanceId - ID of the instance to unregister
      * @returns Success confirmation
      */
    .delete('/system/instances/:instanceId', requireRole('admin')(async ({ params }: any) => {
      if (!configService.isPrimary()) {
        return createErrorResponse('Instance management only available on primary instance');
      }
      const { instanceId } = params;
      await syncService.unregisterInstance(instanceId);
      logger.info(`Instance ${instanceId} unregistered`, 'SYSTEM');
      return createSuccessResponse({ message: 'Instance unregistered successfully' });
    }), {
      params: t.Object({
        instanceId: t.String()
      })
    })
    /**
      * Promote an instance to primary (placeholder implementation)
      * @param params.instanceId - ID of the instance to promote
      * @returns Success confirmation
      */
    .post('/system/instances/:instanceId/promote', requireRole('admin')(async ({ params }: any) => {
      if (!configService.isPrimary()) {
        return createErrorResponse('Instance promotion only available on primary instance');
      }
      const { instanceId } = params;
      // TODO: Implement actual promotion logic
      logger.info(`Instance promotion requested for ${instanceId}`, 'SYSTEM');
      return createSuccessResponse({ message: 'Instance promotion initiated' });
    }), {
      params: t.Object({
        instanceId: t.String()
      })
    })
    /**
     * Test connection to a specific instance
     * @param params.instanceId - ID of the instance to test
     * @returns Connection test result
     */
    .post('/system/instances/:instanceId/test', requireRole('admin')(async ({ params }: any) => {
      if (!configService.isPrimary()) {
        return createErrorResponse('Instance testing only available on primary instance');
      }
      const { instanceId } = params;
      const instance = db.query(`SELECT * FROM monitoring_instances WHERE instance_id = '${instanceId}'`).get() as any;
      if (!instance) {
        return createErrorResponse('Instance not found');
      }
      if (!instance.sync_url) {
        return createErrorResponse('Instance has no sync URL configured');
      }
      try {
        const response = await fetch(`${instance.sync_url}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        const success = response.ok;
        return createSuccessResponse({
          success,
          status: response.status,
          message: success ? 'Connection successful' : `Connection failed with status ${response.status}`
        });
      } catch (error) {
        return createSuccessResponse({
          success: false,
          message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }), {
      params: t.Object({
        instanceId: t.String()
      })
    })

    /**
       * Get system information
       * @returns System information including platform, memory, CPU details
       */
    .get('/system/info', requireRole('user')(async () => {
      logger.debug('System info endpoint called', 'SYSTEM');
      const systemInfo = configService.getSystemInfo();
      return createSuccessResponse(systemInfo);
    }))
    /**
       * Get authentication status
       * @returns Authentication status and last sync information
       */
    .get('/system/auth-status', requireRole('user')(async () => {
      logger.debug('Auth status endpoint called', 'SYSTEM');
      const isAuthenticated = syncService.getAuthToken() ? true : false;
      const result = {
        isAuthenticated,
        tokenExpiry: null, // JWT tokens have built-in expiry, but we don't track it here
        lastAuth: syncService.getLastHeartbeatSuccess()?.toISOString() || null
      };
      return createSuccessResponse(result);
    }))
    /**
       * Get connection status with primary instance
       * @returns Connection status and sync information
       */
    .get('/system/connection-status', requireRole('user')(async () => {
      logger.debug('Connection status endpoint called', 'SYSTEM');
      const connectionStatus = syncService.getConnectionStatusPublic();
      return createSuccessResponse(connectionStatus);
    }))

    /**
     * Re-authenticate with primary instance
     * @param body.primaryURL - URL of the primary instance
     * @param body.instanceName - Optional new instance name
     * @param body.location - Optional new instance location
     * @returns Re-authentication result
     */
    .post('/system/reauthenticate', requireRole('admin')(async ({ body }: any) => {
      logger.info('Re-authentication endpoint called', 'SYSTEM');
      const { primaryURL, instanceName, location } = body;

      if (!primaryURL) {
        return createErrorResponse('Primary URL is required');
      }

      try {
        // Update configuration if provided
        if (instanceName || location) {
          const updates: any = {};
          if (instanceName) updates.instanceName = instanceName;
          if (location) updates.instanceLocation = location;
          await configService.updateConfig(updates);
          logger.info('Configuration updated during re-authentication', 'SYSTEM');
        }

        // Attempt re-registration
        await syncService.registerWithPrimary();

        logger.info('Re-authentication successful', 'SYSTEM');
        return createSuccessResponse({ message: 'Successfully re-authenticated with primary instance' });
      } catch (error) {
        logger.error(`Re-authentication failed: ${error}`, 'SYSTEM');
        return createErrorResponse(error instanceof Error ? error.message : 'Re-authentication failed');
      }
    }), {
      body: t.Object({
        primaryURL: t.String({ minLength: 1 }),
        instanceName: t.Optional(t.String()),
        location: t.Optional(t.String())
      })
    })

    /**
     * Test overall system connectivity
     * @returns Comprehensive system status report
     */
    .post('/system/test-connection', requireRole('user')(async () => {
      const results = {
        database: { status: 'unknown', message: '' },
        system: { status: 'unknown', message: '', info: null },
        connectivity: { status: 'unknown', message: '' }
      };

      // Test database
      try {
        db.query('SELECT 1').get();
        results.database = { status: 'ok', message: 'Database connected' };
      } catch (error) {
        results.database = { status: 'error', message: error instanceof Error ? error.message : 'Database connection failed' };
      }

      // Get system info
      try {
        const info = configService.getSystemInfo();
        results.system = { status: 'ok', message: '', info };
      } catch (error) {
        results.system = { status: 'error', message: error instanceof Error ? error.message : 'Failed to get system info', info: null };
      }

      // Test external connectivity
      try {
        const response = await fetch('https://httpbin.org/status/200', { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          results.connectivity = { status: 'ok', message: 'External connectivity OK' };
        } else {
          results.connectivity = { status: 'error', message: `HTTP ${response.status}` };
        }
      } catch (error) {
        results.connectivity = { status: 'error', message: error instanceof Error ? error.message : 'External connectivity failed' };
      }

      return createSuccessResponse(results);
    }));
}