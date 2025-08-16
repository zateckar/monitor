import { Elysia } from 'elysia';
import { StatusPageService } from '../services/status-pages';
import { LoggerService } from '../services/logger';

export function createStatusPageRoutes(
  statusPageService: StatusPageService,
  logger: LoggerService,
  requireRole: (role: 'admin' | 'user') => (handler: any) => any
) {
  return new Elysia({ prefix: '/api' })
    // Admin status page management
    .get('/status-pages', requireRole('admin')(async () => {
      return statusPageService.getAll();
    }))
    .post('/status-pages', requireRole('admin')(async ({ body }: any) => {
      const { name, slug, description, is_public, monitor_ids } = body as {
        name: string;
        slug: string;
        description?: string;
        is_public: boolean;
        monitor_ids: number[];
      };

      try {
        return await statusPageService.create({ name, slug, description, is_public, monitor_ids });
      } catch (error) {
        logger.error(`Failed to create status page: ${error}`, 'STATUS_PAGES');
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to create status page' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }))
    .put('/status-pages/:id', requireRole('admin')(async ({ params, body }: any) => {
      const { id } = params;
      const { name, slug, description, is_public, monitor_ids } = body as {
        name: string;
        slug: string;
        description?: string;
        is_public: boolean;
        monitor_ids: number[];
      };

      try {
        return await statusPageService.update(parseInt(id), { name, slug, description, is_public, monitor_ids });
      } catch (error) {
        logger.error(`Failed to update status page: ${error}`, 'STATUS_PAGES');
        const statusCode = error instanceof Error && error.message === 'Status page not found' ? 404 : 400;
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to update status page' }), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }))
    .delete('/status-pages/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;

      try {
        await statusPageService.delete(parseInt(id));
        return { success: true };
      } catch (error) {
        logger.error(`Failed to delete status page: ${error}`, 'STATUS_PAGES');
        const statusCode = error instanceof Error && error.message === 'Status page not found' ? 404 : 500;
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to delete status page' }), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }))
    // Public status page endpoint
    .get('/status/:slug', async ({ params }) => {
      const { slug } = params;

      try {
        return await statusPageService.getPublicStatusPage(slug);
      } catch (error) {
        logger.warn(`Public status page not found: ${slug}`, 'STATUS_PAGES');
        return new Response(JSON.stringify({ error: 'Status page not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    });
}
