import { Elysia, t } from 'elysia';
import { ServiceContainer } from '../services/service-container';
import { createSuccessResponse, createErrorResponse } from '../utils/auth-constants';

/**
 * Creates status page management routes
 * @param services Service container with all required dependencies
 * @returns Elysia route handler for status page management
 */
export function createStatusPageRoutes(services: ServiceContainer) {
  const { statusPageService, logger, requireRole } = services;
  return new Elysia({ prefix: '/api/status-pages' })

    // === Admin Status Page Management ===

    /**
     * Get all status pages
     * @returns Array of status page configurations
     */
    .get('/', requireRole('admin')(async () => {
      return createSuccessResponse(statusPageService.getAll());
    }))

    /**
     * Create a new status page
     * @param body - Status page configuration
     * @returns Created status page
     */
    .post('/', requireRole('admin')(async ({ body, set }: any) => {
      const { name, slug, description, is_public, monitor_ids } = body;

      try {
        return createSuccessResponse(await statusPageService.create({ name, slug, description, is_public, monitor_ids }));
      } catch (error) {
        logger.error(`Failed to create status page: ${error}`, 'STATUS_PAGES');
        set.status = 400;
        return createErrorResponse(error instanceof Error ? error.message : 'Failed to create status page');
      }
    }), {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        slug: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        is_public: t.Boolean(),
        monitor_ids: t.Array(t.Number())
      })
    })
    .put('/:id', requireRole('admin')(async ({ params, body, set }: any) => {
      const { id } = params;
      const { name, slug, description, is_public, monitor_ids } = body;

      try {
        return createSuccessResponse(await statusPageService.update(parseInt(id), { name, slug, description, is_public, monitor_ids }));
      } catch (error) {
        logger.error(`Failed to update status page: ${error}`, 'STATUS_PAGES');
        const statusCode = error instanceof Error && error.message === 'Status page not found' ? 404 : 400;
        set.status = statusCode;
        return createErrorResponse(error instanceof Error ? error.message : 'Failed to update status page');
      }
    }), {
      params: t.Object({
        id: t.String()
      }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        slug: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        is_public: t.Boolean(),
        monitor_ids: t.Array(t.Number())
      })
    })
    .delete('/:id', requireRole('admin')(async ({ params, set }: any) => {
      const { id } = params;

      try {
        await statusPageService.delete(parseInt(id));
        return createSuccessResponse({ success: true });
      } catch (error) {
        logger.error(`Failed to delete status page: ${error}`, 'STATUS_PAGES');
        const statusCode = error instanceof Error && error.message === 'Status page not found' ? 404 : 500;
        set.status = statusCode;
        return createErrorResponse(error instanceof Error ? error.message : 'Failed to delete status page');
      }
    }), {
      params: t.Object({
        id: t.String()
      })
    })

    // === Public Status Page Access ===

    /**
     * Get public status page by slug
     * @param params.slug - Status page slug
     * @returns Public status page data
     */
    .get('/status/:slug', async ({ params, set }) => {
      const { slug } = params;

      try {
        return await statusPageService.getPublicStatusPage(slug);
      } catch (error) {
        logger.warn(`Public status page not found: ${slug}`, 'STATUS_PAGES');
        set.status = 404;
        return createErrorResponse('Status page not found');
      }
    }, {
      params: t.Object({
        slug: t.String({ minLength: 1 })
      })
    });
}
