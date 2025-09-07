import { Elysia } from 'elysia';
import { StaticFileService } from '../services/static-files';
import { createErrorResponse } from '../utils/auth-constants';

export function createStaticRoutes(staticFileService: StaticFileService) {
   return new Elysia()

     // === Static File Serving ===

     /**
      * Serve static files (frontend assets, public files)
      * @param path - Requested file path
      * @returns Static file content or 404 if not found
      */
     .get('/*', async ({ request, set, path }) => {
      // Skip API routes - let them be handled by other route handlers
      if (path.startsWith('/api/')) {
        set.status = 404;
        return createErrorResponse('API route not found');
      }

      return await staticFileService.serveFile(request, set);
    });
}
