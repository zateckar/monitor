import { Elysia } from 'elysia';
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
import { NotificationService } from './services/notifications';

// Import route handlers
import { createAuthRoutes, createAuthMiddleware } from './routes/auth';
import { createEndpointsRoutes } from './routes/endpoints';
import { createUserRoutes } from './routes/users';
import { createOIDCRoutes } from './routes/oidc';

async function main() {
  // Initialize database
  const db = initializeDatabase();

  // Initialize services
  const logger = new LoggerService(db);
  const authService = new AuthService(db);
  const oidcService = new OIDCService(db, logger);
  const kafkaService = new KafkaService(db, logger);
  const notificationService = new NotificationService(db, logger);
  
  // Create monitoring service with notification callback
  const monitoringService = new MonitoringService(
    db, 
    logger, 
    kafkaService,
    (endpoint, status) => notificationService.sendNotification(endpoint, status)
  );

  // Create authentication middleware
  const { requireAuth, requireRole } = createAuthMiddleware(authService);

  logger.info('Starting Endpoint Monitor application', 'SYSTEM');

  // Create default admin user if none exists
  await authService.createDefaultAdminUser();

  const app = new Elysia()
    .use(cors())
    // Mount route handlers
    .use(createAuthRoutes(authService, logger))
    .use(createEndpointsRoutes(db, authService, logger, monitoringService, requireAuth, requireRole))
    .use(createUserRoutes(db, authService, logger, requireRole))
    .use(createOIDCRoutes(db, oidcService, authService, logger, requireRole))
    
    // Notification services API
    .get('/api/notification-services', async () => {
      return notificationService.getNotificationServices();
    })
    .post('/api/notification-services', requireRole('admin')(async ({ request }: any) => {
      let body: any;
      try {
        body = await request.json();
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const { name, type, config } = body as { name: string, type: string, config: object };
      return notificationService.createNotificationService(name, type, config);
    }))
    .put('/api/notification-services/:id', requireRole('admin')(async ({ params, request }: any) => {
      const { id } = params;
      let body: any;
      try {
        body = await request.json();
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const { name, type, config } = body as { name: string, type: string, config: object };
      return notificationService.updateNotificationService(parseInt(id), name, type, config);
    }))
    .delete('/api/notification-services/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;
      notificationService.deleteNotificationService(parseInt(id));
      return { id };
    }))
    .get('/api/endpoints/:id/notification-services', async ({ params }: any) => {
      const { id } = params;
      return notificationService.getEndpointNotificationServices(parseInt(id));
    })
    .post('/api/endpoints/:id/notification-services', requireRole('admin')(async ({ params, request }: any) => {
      const { id } = params;
      let body: any;
      try {
        body = await request.json();
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const { serviceId } = body as { serviceId: number };
      notificationService.addNotificationServiceToEndpoint(parseInt(id), serviceId);
      return { monitor_id: id, notification_service_id: serviceId };
    }))
    .delete('/api/endpoints/:id/notification-services/:serviceId', requireRole('admin')(async ({ params }: any) => {
      const { id, serviceId } = params;
      notificationService.removeNotificationServiceFromEndpoint(parseInt(id), parseInt(serviceId));
      return { monitor_id: id, notification_service_id: serviceId };
    }))
    
    // OIDC Authentication API
    .get('/api/auth/oidc/providers', async () => {
      return oidcService.getProviders();
    })
    
    // Application logs API
    .get('/api/logs', requireRole('admin')(async () => {
      return logger.getLogs();
    }))
    .delete('/api/logs', requireRole('admin')(async () => {
      logger.clearLogs();
      return { success: true };
    }))
    .get('/api/logs/level', requireRole('admin')(async () => {
      return { level: logger.getLogLevel() };
    }))
    .put('/api/logs/level', requireRole('admin')(async ({ request }: any) => {
      let body: any;
      try {
        body = await request.json();
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const { level } = body as { level: string };
      console.log('PUT /api/logs/level called with level:', level);
      logger.setLogLevel(level);
      console.log('After setLogLevel, current level is:', logger.getLogLevel());
      return { level };
    }))
    
    // Database management API
    .get('/api/database/stats', requireRole('admin')(async () => {
      try {
        // Get database file size
        const dbFile = Bun.file(path.join(import.meta.dir, '..', 'db.sqlite'));
        const dbSizeBytes = await dbFile.size;
        const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);
        
        // Get table information
        const tables = db.query(`
          SELECT name 
          FROM sqlite_master 
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `).all() as any[];

        const tableStats = tables.map(table => {
          try {
            // Get row count for each table
            const rowCount = db.query(`SELECT COUNT(*) as count FROM "${table.name}"`).get() as any;
            
            // Calculate approximate table size (this is an estimation)
            const tableInfo = db.query(`PRAGMA table_info("${table.name}")`).all() as any[];
            const avgRowSize = tableInfo.length * 50; // Rough estimate: 50 bytes per column
            const estimatedSizeBytes = rowCount.count * avgRowSize;
            const estimatedSizeKB = (estimatedSizeBytes / 1024).toFixed(2);
            const estimatedSizeKBNum = parseFloat(estimatedSizeKB);
            
            return {
              name: table.name,
              rows: rowCount.count,
              size: estimatedSizeKBNum < 1024 ? `${estimatedSizeKB} KB` : `${(estimatedSizeBytes / (1024 * 1024)).toFixed(2)} MB`
            };
          } catch (err) {
            // If there's an error querying a specific table, return minimal info
            return {
              name: table.name,
              rows: 0,
              size: '0 KB'
            };
          }
        });

        const dbSizeMBNum = parseFloat(dbSizeMB);
        return {
          size: dbSizeMBNum < 1024 ? `${dbSizeMB} MB` : `${(dbSizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`,
          tables: tableStats
        };
      } catch (error) {
        logger.error(`Error getting database stats: ${error}`, 'DATABASE');
        return {
          size: 'Unknown',
          tables: []
        };
      }
    }))
    .post('/api/database/vacuum', requireRole('admin')(async () => {
      try {
        // Run VACUUM command to optimize database
        db.exec('VACUUM');
        logger.info('Database vacuum completed successfully', 'DATABASE');
        return { success: true, message: 'Database vacuum completed successfully' };
      } catch (error) {
        logger.error(`Database vacuum failed: ${error}`, 'DATABASE');
        throw new Error(`Database vacuum failed: ${error}`);
      }
    }))
    
    // Static file serving (fallback for SPA)
    .get('/*', async ({ request, set }) => {
      const url = new URL(request.url);
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

  console.log(
    `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
  );

  // Start monitoring all endpoints
  await monitoringService.initializeMonitoring();
}

main();
