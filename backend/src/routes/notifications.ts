import { Elysia, t } from 'elysia';
import { ServiceContainer } from '../services/service-container';
import { createSuccessResponse, createErrorResponse } from '../utils/auth-constants';
import { validateAndSanitizeText, MAX_LENGTHS } from '../utils/validation';

/**
 * Creates notification services management routes
 * @param services Service container with all required dependencies
 * @returns Elysia route handler for notification services management
 */
export function createNotificationRoutes(services: ServiceContainer) {
  const { db, notificationService, requireRole } = services;
  return new Elysia({ prefix: '/api/notifications' })

    // === Notification Services Management ===

    /**
     * Get all notification services
     * @returns Array of configured notification services
     */
    .get('/notification-services', requireRole('user')(async () => {
      return createSuccessResponse(notificationService.getNotificationServices());
    }))

    /**
     * Create a new notification service
     * @param body - Notification service configuration
     * @returns Created notification service
     */
    .post('/notification-services', requireRole('admin')(async ({ body, set }: any) => {
      const { name, type, config } = body;

      // Validate and sanitize name
      const nameValidation = validateAndSanitizeText(name, MAX_LENGTHS.NAME, 'Name');
      if (!nameValidation.isValid) {
        set.status = 400;
        return createErrorResponse(nameValidation.error || 'Invalid name');
      }

      // Validate and sanitize type
      const typeValidation = validateAndSanitizeText(type, MAX_LENGTHS.NAME, 'Type');
      if (!typeValidation.isValid) {
        set.status = 400;
        return createErrorResponse(typeValidation.error || 'Invalid type');
      }

      return createSuccessResponse(notificationService.createNotificationService(
        nameValidation.sanitizedValue!,
        typeValidation.sanitizedValue!,
        config
      ));
    }), {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        type: t.String({ minLength: 1 }),
        config: t.Record(t.String(), t.Unknown())
      })
    })
    .put('/notification-services/:id', requireRole('admin')(async ({ params, body, set }: any) => {
      const { id } = params;
      const { name, type, config } = body;

      // Validate and sanitize name if provided
      let sanitizedName = name;
      if (name) {
        const nameValidation = validateAndSanitizeText(name, MAX_LENGTHS.NAME, 'Name');
        if (!nameValidation.isValid) {
          set.status = 400;
          return createErrorResponse(nameValidation.error || 'Invalid name');
        }
        sanitizedName = nameValidation.sanitizedValue;
      }

      // Validate and sanitize type if provided
      let sanitizedType = type;
      if (type) {
        const typeValidation = validateAndSanitizeText(type, MAX_LENGTHS.NAME, 'Type');
        if (!typeValidation.isValid) {
          set.status = 400;
          return createErrorResponse(typeValidation.error || 'Invalid type');
        }
        sanitizedType = typeValidation.sanitizedValue;
      }

      return createSuccessResponse(notificationService.updateNotificationService(parseInt(id), sanitizedName, sanitizedType, config));
    }), {
      params: t.Object({
        id: t.String()
      }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        type: t.String({ minLength: 1 }),
        config: t.Record(t.String(), t.Unknown())
      })
    })
    .delete('/notification-services/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;
      notificationService.deleteNotificationService(parseInt(id));
      return createSuccessResponse({ id });
    }), {
      params: t.Object({
        id: t.String()
      })
    })

    /**
     * Test a notification service
     * @param params.id - Notification service ID
     * @returns Test result
     */
    .post('/notification-services/:id/test', requireRole('admin')(async ({ params, set }: any) => {
      const { id } = params;

      try {
        const result = await notificationService.testNotificationService(parseInt(id));
        return createSuccessResponse(result);
      } catch (error) {
        set.status = 400;
        return createErrorResponse(error instanceof Error ? error.message : 'Test failed');
      }
    }), {
      params: t.Object({
        id: t.String()
      })
    })

    // === Endpoint-Notification Associations ===

    /**
     * Get notification services associated with an endpoint
     * @param params.id - Endpoint ID
     * @returns Array of associated notification services
     */
    .get('/endpoints/:id/notification-services', requireRole('user')(async ({ params }: any) => {
      const { id } = params;
      return createSuccessResponse(notificationService.getEndpointNotificationServices(parseInt(id)));
    }), {
      params: t.Object({
        id: t.String()
      })
    })

    /**
     * Associate a notification service with an endpoint
     * @param params.id - Endpoint ID
     * @param body.serviceId - Notification service ID
     * @returns Association confirmation
     */
    .post('/endpoints/:id/notification-services', requireRole('admin')(async ({ params, body }: any) => {
      const { id } = params;
      const { serviceId } = body;
      notificationService.addNotificationServiceToEndpoint(parseInt(id), serviceId);
      return createSuccessResponse({ monitor_id: id, notification_service_id: serviceId });
    }), {
      params: t.Object({
        id: t.String()
      }),
      body: t.Object({
        serviceId: t.Number()
      })
    })

    /**
     * Remove notification service association from an endpoint
     * @param params.id - Endpoint ID
     * @param params.serviceId - Notification service ID
     * @returns Removal confirmation
     */
    .delete('/endpoints/:id/notification-services/:serviceId', requireRole('admin')(async ({ params }: any) => {
      const { id, serviceId } = params;
      notificationService.removeNotificationServiceFromEndpoint(parseInt(id), parseInt(serviceId));
      return createSuccessResponse({ monitor_id: id, notification_service_id: serviceId });
    }), {
      params: t.Object({
        id: t.String(),
        serviceId: t.String()
      })
    });
}
