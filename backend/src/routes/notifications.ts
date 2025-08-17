import { Elysia } from 'elysia';
import { Database } from 'bun:sqlite';
import { LoggerService } from '../services/logger';
import { NotificationService } from '../services/notifications';

export function createNotificationRoutes(
  db: Database,
  logger: LoggerService
) {
  const notificationService = new NotificationService(db, logger);
  return new Elysia({ prefix: '/api' })
    .get('/notification-services', async () => {
      const services = db.query('SELECT * FROM notification_services').all() as any[];
      return services.map(service => ({
        ...service,
        config: JSON.parse(service.config)
      }));
    })
    .post('/notification-services', async ({ body }) => {
      const { name, type, config } = body as { name: string, type: string, config: object };
      const result = db.run('INSERT INTO notification_services (name, type, config) VALUES (?, ?, ?)', [name, type, JSON.stringify(config)]);
      
      logger.info(`Created notification service "${name}" of type ${type}`, 'NOTIFICATIONS');
      
      return { id: result.lastInsertRowid, name, type, config };
    })
    .put('/notification-services/:id', async ({ params, body }) => {
      const { id } = params;
      const { name, type, config } = body as { name: string, type: string, config: object };
      
      // Check if service exists
      const existingService = db.query('SELECT name FROM notification_services WHERE id = ?').get(id) as any;
      if (!existingService) {
        return new Response(JSON.stringify({ error: 'Notification service not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      db.run('UPDATE notification_services SET name = ?, type = ?, config = ? WHERE id = ?', [name, type, JSON.stringify(config), id]);
      
      logger.info(`Updated notification service "${name}" (ID: ${id})`, 'NOTIFICATIONS');
      
      return { id, name, type, config };
    })
    .delete('/notification-services/:id', async ({ params }) => {
      const { id } = params;
      
      // Get service name before deletion
      const service = db.query('SELECT name FROM notification_services WHERE id = ?').get(id) as any;
      if (!service) {
        return new Response(JSON.stringify({ error: 'Notification service not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Remove associations first
      db.run('DELETE FROM monitor_notification_services WHERE notification_service_id = ?', [id]);
      
      // Then delete the service
      db.run('DELETE FROM notification_services WHERE id = ?', [id]);
      
      logger.info(`Deleted notification service "${service.name}" (ID: ${id})`, 'NOTIFICATIONS');
      
      return { id };
    })
    .get('/endpoints/:id/notification-services', async ({ params }) => {
      const { id } = params;
      const services = db.query(
        `SELECT ns.* FROM notification_services ns
         JOIN monitor_notification_services mns ON ns.id = mns.notification_service_id
         WHERE mns.monitor_id = ?`
      ).all(id) as any[];
      return services.map(service => ({
        ...service,
        config: JSON.parse(service.config)
      }));
    })
    .post('/endpoints/:id/notification-services', async ({ params, body }) => {
      const { id } = params;
      const { serviceId } = body as { serviceId: number };
      
      // Check if endpoint exists
      const endpoint = db.query('SELECT name FROM endpoints WHERE id = ?').get(id) as any;
      if (!endpoint) {
        return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Check if service exists
      const service = db.query('SELECT name FROM notification_services WHERE id = ?').get(serviceId) as any;
      if (!service) {
        return new Response(JSON.stringify({ error: 'Notification service not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Check if association already exists
      const existingAssociation = db.query('SELECT * FROM monitor_notification_services WHERE monitor_id = ? AND notification_service_id = ?').get(id, serviceId) as any;
      if (existingAssociation) {
        return new Response(JSON.stringify({ error: 'Association already exists' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      db.run('INSERT INTO monitor_notification_services (monitor_id, notification_service_id) VALUES (?, ?)', [id, serviceId]);
      
      logger.info(`Associated notification service "${service.name}" with endpoint "${endpoint.name}"`, 'NOTIFICATIONS');
      
      return { monitor_id: id, notification_service_id: serviceId };
    })
    .delete('/endpoints/:id/notification-services/:serviceId', async ({ params }) => {
      const { id, serviceId } = params;
      
      // Get names for logging
      const endpoint = db.query('SELECT name FROM endpoints WHERE id = ?').get(id) as any;
      const service = db.query('SELECT name FROM notification_services WHERE id = ?').get(serviceId) as any;
      
      db.run('DELETE FROM monitor_notification_services WHERE monitor_id = ? AND notification_service_id = ?', [id, serviceId]);
      
      if (endpoint && service) {
        logger.info(`Removed association between notification service "${service.name}" and endpoint "${endpoint.name}"`, 'NOTIFICATIONS');
      }
      
      return { monitor_id: id, notification_service_id: serviceId };
    })
    .post('/notification-services/:id/test', async ({ params }) => {
      const { id } = params;
      
      try {
        const result = await notificationService.testNotificationService(parseInt(id));
        
        if (result.success) {
          return { success: true, message: 'Test notification sent successfully' };
        } else {
          return new Response(JSON.stringify({ 
            success: false, 
            error: result.error || 'Failed to send test notification' 
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: `Unexpected error: ${errorMessage}` 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    });
}
