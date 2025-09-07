import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import path from 'path';
import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import { gzipSync } from 'bun';

// Import configuration and database
import { initializeDatabase } from './config/database';

// Import services
import { AuthService } from './services/auth';
import { LoggerService } from './services/logger';
import { OIDCService } from './services/oidc';
import { KafkaService } from './services/kafka';
import { MonitoringService } from './services/monitoring';
import { DistributedMonitoringService } from './services/distributed-monitoring';
import { ConfigurationService } from './services/configuration';
import { SynchronizationService } from './services/synchronization';
import { FailoverManager } from './services/failover';
import { NotificationService } from './services/notifications';
import { DomainInfoService } from './services/domain-info';
import { CertificateService } from './services/certificate';
import { StatusPageService } from './services/status-pages';
import { DatabaseService } from './services/database';

// Import new route registration system
import { RouteAutoRegistry } from './utils/route-registry';
import { createGlobalErrorHandler } from './utils/error-handler';
import { apiVersionMiddleware } from './utils/api-versioning';

// Import service container
import { ServiceContainer } from './services/service-container';

async function main() {
  // Initialize database
  const db = initializeDatabase();

  // Initialize services
  const logger = new LoggerService(db);
  const databaseService = new DatabaseService(db, logger);
  const authService = new AuthService(db);
  const oidcService = new OIDCService(db, logger);
  const kafkaService = new KafkaService(db, logger);
  const notificationService = new NotificationService(db, logger);
  const domainInfoService = new DomainInfoService(logger);
  const certificateService = new CertificateService(logger);
  const statusPageService = new StatusPageService(db, logger);
  
  // Initialize distributed monitoring services
  const configService = new ConfigurationService(db, logger);
  const syncService = new SynchronizationService(db, configService, logger);
  const failoverManager = new FailoverManager(db, configService, syncService, logger);
  
  // Create distributed monitoring service with notification callback
  const distributedMonitoringService = new DistributedMonitoringService(
    db,
    logger,
    kafkaService,
    domainInfoService,
    certificateService,
    (endpoint: any, status: string) => notificationService.sendNotification(endpoint, status),
    configService,
    syncService,
    failoverManager
  );

  // Log instance configuration
  configService.logCurrentConfiguration();
  logger.info('Starting Endpoint Monitor application', 'SYSTEM');

  // Create default admin user if none exists
  await authService.createDefaultAdminUser();

  // Create service container to simplify parameter passing
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
    undefined, // requireAuth will be set later
    undefined  // requireRole will be set later
  );

  // Initialize route registry with auto-discovery
  const routeRegistry = RouteAutoRegistry.getInstance();
  await routeRegistry.autoDiscoverRoutes();

  // Create authentication middleware (keeping for backward compatibility)
  const { createAuthMiddleware } = await import('./routes/auth');
  const authMiddleware = createAuthMiddleware(services);
  const requireAuth = authMiddleware?.requireAuth;
  const requireRole = authMiddleware?.requireRole;

  // Update service container with middleware functions
  services.requireAuth = requireAuth;
  services.requireRole = requireRole;

  logger.info(`Auto-discovered ${routeRegistry.getStats().totalRoutes} route modules`, 'SYSTEM');

  // Create main application with auto-discovered routes
  const app = await routeRegistry.createApp(services);

  // Add global middleware and static file serving
  app
    .use(cors())
    .use(apiVersionMiddleware())
    .onError(({ code, error, set }: any) => {
      logger.error(`Request error: ${error.message}`, 'ERROR_HANDLER');
      set.status = 500;
      return { success: false, error: error.message };
    })
    .get('/*', async ({ request, set }: any) => {
      // Static file serving (fallback for SPA) - exclude API routes
      const url = new URL(request.url);

      console.log('CATCH-ALL ROUTE CALLED for path:', url.pathname);

      // Skip API routes - let them fall through to proper handlers
      if (url.pathname.startsWith('/api/')) {
        console.log('CATCH-ALL: Skipping API route:', url.pathname);
        console.log('CATCH-ALL: This should not happen if specific routes are working');
        console.log('CATCH-ALL: Available routes on app:', Object.keys((app as any).routes || {}));
        set.status = 404;
        return new Response(JSON.stringify({ error: 'API route not found', path: url.pathname }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const assetPath = url.pathname === '/' ? 'index.html' : url.pathname.substring(1);
      const filePath = path.join(import.meta.dir, '..', '..', 'frontend', 'dist', assetPath);

      const file = Bun.file(filePath);

      if (await file.exists()) {
        try {
          const stats = await stat(filePath);
          const lastModified = stats.mtime.toUTCString();
          const etag = `"${createHash('md5').update(`${stats.size}-${stats.mtime.getTime()}`).digest('hex')}"`;

          // Check if client has cached version (304 Not Modified)
          const ifNoneMatch = request.headers.get('if-none-match');
          const ifModifiedSince = request.headers.get('if-modified-since');

          if (ifNoneMatch === etag || ifModifiedSince === lastModified) {
            set.status = 304;
            return new Response(null, { status: 304 });
          }

          // Determine file type and set appropriate cache headers and Content-Type
          const ext = path.extname(filePath).toLowerCase();
          let cacheControl: string;
          let contentType: string;

          // Set Content-Type based on file extension
          switch (ext) {
            case '.html':
              contentType = 'text/html; charset=utf-8';
              break;
            case '.css':
              contentType = 'text/css; charset=utf-8';
              break;
            case '.js':
              contentType = 'application/javascript; charset=utf-8';
              break;
            case '.json':
              contentType = 'application/json; charset=utf-8';
              break;
            case '.png':
              contentType = 'image/png';
              break;
            case '.jpg':
            case '.jpeg':
              contentType = 'image/jpeg';
              break;
            case '.gif':
              contentType = 'image/gif';
              break;
            case '.svg':
              contentType = 'image/svg+xml; charset=utf-8';
              break;
            case '.ico':
              contentType = 'image/x-icon';
              break;
            case '.webp':
              contentType = 'image/webp';
              break;
            case '.woff':
              contentType = 'font/woff';
              break;
            case '.woff2':
              contentType = 'font/woff2';
              break;
            case '.ttf':
              contentType = 'font/ttf';
              break;
            case '.eot':
              contentType = 'application/vnd.ms-fontobject';
              break;
            case '.xml':
              contentType = 'application/xml; charset=utf-8';
              break;
            case '.txt':
              contentType = 'text/plain; charset=utf-8';
              break;
            default:
              contentType = 'application/octet-stream';
          }

          if (['.js', '.css', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
            // Long cache for hashed assets (1 year)
            cacheControl = 'public, max-age=31536000, immutable';
          } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'].includes(ext)) {
            // Medium cache for images (1 week)
            cacheControl = 'public, max-age=604800';
          } else {
            // Short cache for HTML and other files (1 hour)
            cacheControl = 'public, max-age=3600';
          }

          // Set security and performance headers
          const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Cache-Control': cacheControl,
            'ETag': etag,
            'Last-Modified': lastModified,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block'
          };

          // Add compression for text-based files
          const acceptEncoding = request.headers.get('accept-encoding') || '';
          const isCompressible = ['.js', '.css', '.html', '.json', '.xml', '.txt', '.svg'].includes(ext);

          if (isCompressible && acceptEncoding.includes('gzip')) {
            try {
              const fileContent = await file.arrayBuffer();
              const compressed = gzipSync(new Uint8Array(fileContent));
              headers['Content-Encoding'] = 'gzip';
              headers['Content-Length'] = compressed.length.toString();

              return new Response(compressed, { headers });
            } catch (compressionError) {
              // Fall back to uncompressed if compression fails
              console.warn('Compression failed, serving uncompressed:', compressionError);
            }
          }

          return new Response(file, { headers });
        } catch (error) {
          // If stat fails, serve file without caching headers
          console.warn('Failed to get file stats, serving without optimization:', error);
          return file;
        }
      }

      // Fallback to index.html for SPA routing (with appropriate headers)
      const indexPath = path.join(import.meta.dir, '..', '..', 'frontend', 'dist', 'index.html');
      const indexFile = Bun.file(indexPath);

      if (await indexFile.exists()) {
        const headers = {
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block'
        };

        return new Response(indexFile, { headers });
      }

      // Final fallback - 404
      set.status = 404;
      return new Response('Not Found', { status: 404 });
    })
    .listen(3001);

  console.log('=== REGISTERED ROUTES ===');
  console.log('App routes:', (app as any).routes);
  console.log('==========================');

  console.log(
    `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
  );

  // Start distributed monitoring
  await distributedMonitoringService.initializeMonitoring();
}

main();
