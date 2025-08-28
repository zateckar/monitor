import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import path from 'path';
import { Database } from 'bun:sqlite';
import ping from 'ping';
import net from 'net';
import tls from 'tls';
import https from 'https';
import jwt from 'jsonwebtoken';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import * as openidClient from 'openid-client';
import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import { gzipSync } from 'bun';

// Import types and configuration
import type { MonitorType, User, OIDCProvider, UserSession, Endpoint } from './src/types';
import { JWT_SECRET, JWT_EXPIRES_IN, DB_PATH } from './src/config/constants';
import { initializeDatabase } from './src/config/database';

// Import services
import { LoggerService } from './src/services/logger';
import { AuthService } from './src/services/auth';
import { OIDCService } from './src/services/oidc';
import { MonitoringService } from './src/services/monitoring';
import { NotificationService } from './src/services/notifications';
import { DatabaseService } from './src/services/database';
import { StatusPageService } from './src/services/status-pages';
import { StaticFileService } from './src/services/static-files';
import { CertificateService } from './src/services/certificate';
import { DomainInfoService } from './src/services/domain-info';

// Import route factories
import { createAuthRoutes, createAuthMiddleware } from './src/routes/auth';
import { createEndpointsRoutes } from './src/routes/endpoints';
import { createOIDCRoutes } from './src/routes/oidc';
import { createUserRoutes } from './src/routes/users';
import { createNotificationRoutes } from './src/routes/notifications';
import { createStatusPageRoutes } from './src/routes/status-pages';
import { createSystemRoutes } from './src/routes/system';
import { createStaticRoutes } from './src/routes/static';
import { createPreferencesRoutes } from './src/routes/preferences';

// Import utilities
import { calculateGapAwareUptime } from './src/utils/uptime';
import { formatDuration } from './src/utils/formatting';

// Helper function to create HTTP agent with mTLS support
function createHttpAgent(endpoint: Endpoint): https.Agent | undefined {
  if (!endpoint.client_cert_enabled || !endpoint.client_cert_private_key || !endpoint.client_cert_public_key) {
    return undefined;
  }

  try {
    const options: any = {
      cert: endpoint.client_cert_public_key,
      key: endpoint.client_cert_private_key,
      rejectUnauthorized: true, // Verify server certificate
    };

    // Add CA certificate if provided
    if (endpoint.client_cert_ca) {
      options.ca = endpoint.client_cert_ca;
    }

    return new https.Agent(options);
  } catch (error) {
    console.error(`Error creating mTLS agent for endpoint ${endpoint.id}: ${error}`);
    return undefined;
  }
}

async function main() {
  // Initialize database
  const db = initializeDatabase();

  // Initialize services
  const logger = new LoggerService(db);
  const authService = new AuthService(db);
  const oidcService = new OIDCService(db, logger);
  const certificateService = new CertificateService(logger);
  const domainInfoService = new DomainInfoService(logger);
  const databaseService = new DatabaseService(db, logger);
  const statusPageService = new StatusPageService(db, logger);
  const staticFileService = new StaticFileService();
  const notificationService = new NotificationService(db, logger);
  
  // Create send notification function for monitoring service
  const sendNotification = async (endpoint: Endpoint, status: string) => {
    await notificationService.sendNotification(endpoint, status);
  };
  
  // Import and initialize KafkaService
  const { KafkaService } = await import('./src/services/kafka');
  const kafkaService = new KafkaService(db, logger);
  
  const monitoringService = new MonitoringService(
    db,
    logger,
    kafkaService,
    domainInfoService,
    certificateService,
    sendNotification
  );

  logger.info('Starting Endpoint Monitor application', 'SYSTEM');

  // Create default admin user if no users exist
  await authService.createDefaultAdminUser();

  // Create authentication middleware
  const authMiddleware = createAuthMiddleware(authService);
  const { requireAuth, requireRole } = authMiddleware;

  // Create route instances
  const authRoutes = createAuthRoutes(authService, logger);
  const endpointsRoutes = createEndpointsRoutes(db, authService, logger, monitoringService, domainInfoService, certificateService, requireAuth, requireRole);
  const oidcRoutes = createOIDCRoutes(db, oidcService, authService, logger, requireRole);
  const userRoutes = createUserRoutes(db, authService, logger, requireRole);
  const notificationRoutes = createNotificationRoutes(db, logger);
  const statusPageRoutes = createStatusPageRoutes(statusPageService, logger, requireRole);
  const systemRoutes = createSystemRoutes(db, databaseService, logger);
  const preferencesRoutes = createPreferencesRoutes(db, requireRole);
  const staticRoutes = createStaticRoutes(staticFileService);

  // Create main Elysia app
  const app = new Elysia()
    .use(cors())
    .onRequest((context) => {
      // Ensure Content-Type is properly handled
      const contentType = context.request.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        // Elysia should automatically parse JSON, but let's make sure
        return;
      }
    })
    // Mount all route modules
    .use(authRoutes)
    .use(endpointsRoutes)
    .use(oidcRoutes)
    .use(userRoutes)
    .use(notificationRoutes)
    .use(statusPageRoutes)
    .use(systemRoutes)
    .use(preferencesRoutes)
    // Static file routes must be last (catch-all)
    .use(staticRoutes)
    .listen(3001);

  console.log(
    `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
  );

  // Initialize monitoring for all existing endpoints
  const initializeMonitoring = async () => {
    try {
      const endpoints: Endpoint[] = db.query('SELECT * FROM endpoints').all() as Endpoint[];
      logger.info(`Starting monitoring for ${endpoints.length} endpoints`, 'MONITORING');
      
      for (const endpoint of endpoints) {
        logger.info(`Starting monitor for "${endpoint.name}" (ID: ${endpoint.id}) with ${endpoint.heartbeat_interval || 60}s interval`, 'MONITORING');
        monitoringService.startEndpointMonitoring(endpoint);
      }
    } catch (err) {
      logger.error(`Error initializing monitoring: ${err}`, 'MONITORING');
    }
  };

  // Start monitoring all endpoints
  initializeMonitoring();
}

main();
