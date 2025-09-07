import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { helmet } from 'elysia-helmet';
import { rateLimit } from 'elysia-rate-limit';
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
import { DistributedMonitoringService } from './src/services/distributed-monitoring';
import { NotificationService } from './src/services/notifications';
import { DatabaseService } from './src/services/database';
import { StatusPageService } from './src/services/status-pages';
import { StaticFileService } from './src/services/static-files';
import { CertificateService } from './src/services/certificate';
import { DomainInfoService } from './src/services/domain-info';
import { ConfigurationService } from './src/services/configuration';
import { SynchronizationService } from './src/services/synchronization';
import { FailoverManager } from './src/services/failover';
import { ServiceContainer } from './src/services/service-container';

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
import { createSyncRoutes } from './src/routes/sync';

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
  const configService = new ConfigurationService(db, logger);
  const syncService = new SynchronizationService(db, configService, logger);
  const failoverManager = new FailoverManager(db, configService, syncService, logger);
  
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

  const distributedMonitoringService = new DistributedMonitoringService(
    db,
    logger,
    kafkaService,
    domainInfoService,
    certificateService,
    sendNotification,
    configService,
    syncService,
    failoverManager
  );

  logger.info('Starting Endpoint Monitor application', 'SYSTEM');

  // Create default admin user if no users exist
  await authService.createDefaultAdminUser();

  // Create service container first (needed for auth middleware)
  const tempServices = ServiceContainer.create(
    db,
    logger,
    databaseService,
    authService,
    oidcService,
    kafkaService,
    notificationService,
    domainInfoService,
    certificateService,
    statusPageService,
    configService,
    syncService,
    failoverManager,
    distributedMonitoringService
  );

  // Create authentication middleware
  const authMiddleware = createAuthMiddleware(tempServices);
  const { requireAuth, requireRole } = authMiddleware;

  // Create service container
  const services = ServiceContainer.create(
    db,
    logger,
    databaseService,
    authService,
    oidcService,
    kafkaService,
    notificationService,
    domainInfoService,
    certificateService,
    statusPageService,
    configService,
    syncService,
    failoverManager,
    distributedMonitoringService,
    requireAuth,
    requireRole
  );

  // Create route instances
  const authRoutes = createAuthRoutes(services);
  const endpointsRoutes = createEndpointsRoutes(services);
  const oidcRoutes = createOIDCRoutes(services);
  const userRoutes = createUserRoutes(services);
  const notificationRoutes = createNotificationRoutes(services);
  const statusPageRoutes = createStatusPageRoutes(services);
  const systemRoutes = createSystemRoutes(services);
  const preferencesRoutes = createPreferencesRoutes(services);
  const syncRoutes = createSyncRoutes(services);
  const staticRoutes = createStaticRoutes(staticFileService);

  // Create main Elysia app
  const app = new Elysia()
    .use(cors({
      origin: process.env.NODE_ENV === 'production' ? 'https://your-production-domain.com' : 'http://localhost:5173',
      credentials: true,
    }))
    .use(helmet())
    .use(rateLimit({
      duration: 60 * 1000, // 1 minute
      max: 100, // 100 requests per minute
    }))
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
    .use(syncRoutes)
    // Static file routes must be last (catch-all)
    .use(staticRoutes)
    .listen(process.env.PORT ? parseInt(process.env.PORT) : 3001);

  console.log(
    `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
  );

  // Initialize monitoring for all existing endpoints
  const initializeMonitoring = async () => {
    try {
      await distributedMonitoringService.initializeMonitoring();
      logger.info('Distributed monitoring initialized', 'MONITORING');
    } catch (err) {
      logger.error(`Error initializing distributed monitoring: ${err}`, 'MONITORING');
    }
  };

  // Start monitoring all endpoints
  initializeMonitoring();
}

main();