import { Database } from 'bun:sqlite';
import type { Endpoint } from '../types';
import { LoggerService } from './logger';

export class NotificationService {
  constructor(private db: Database, private logger: LoggerService) {}

  async sendNotification(endpoint: Endpoint, status: string): Promise<void> {
    const services = this.db.query(
      `SELECT ns.* FROM notification_services ns
       JOIN monitor_notification_services mns ON ns.id = mns.notification_service_id
       WHERE mns.monitor_id = ?`
    ).all(endpoint.id) as any[];

    for (const service of services) {
      const config = JSON.parse(service.config);
      const message = `Monitor "${endpoint.name}" (${endpoint.url}) is now ${status}.`;

      try {
        if (service.type === 'telegram') {
          await this.sendTelegramNotification(config, message);
        } else if (service.type === 'sendgrid') {
          await this.sendSendGridNotification(config, message, endpoint, status);
        } else if (service.type === 'slack') {
          await this.sendSlackNotification(config, message);
        } else if (service.type === 'apprise') {
          await this.sendAppriseNotification(config, message, endpoint, status);
        }
      } catch (error) {
        await this.logger.error(`Failed to send notification for endpoint ${endpoint.id} via ${service.name}: ${error}`, 'NOTIFICATIONS');
      }
    }
  }

  private async sendTelegramNotification(config: any, message: string): Promise<void> {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
      }),
    });
  }

  private async sendSendGridNotification(config: any, message: string, endpoint: Endpoint, status: string): Promise<void> {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: config.toEmail }] }],
        from: { email: config.fromEmail },
        subject: `Monitor Status: ${endpoint.name} is ${status}`,
        content: [{ type: 'text/plain', value: message }],
      }),
    });
  }

  private async sendSlackNotification(config: any, message: string): Promise<void> {
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
  }

  private async sendAppriseNotification(config: any, message: string, endpoint: Endpoint, status: string): Promise<void> {
    const notificationUrls = config.notificationUrls?.split('\n').filter((url: string) => url.trim());
    
    if (config.serverUrl && notificationUrls && notificationUrls.length > 0) {
      // Use Apprise API server
      await fetch(`${config.serverUrl}/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urls: notificationUrls,
          title: `Monitor Status: ${endpoint.name}`,
          body: message,
          type: status === 'DOWN' ? 'failure' : 'success',
        }),
      });
    }
  }

  // Service management methods
  getNotificationServices(): any[] {
    const services = this.db.query('SELECT * FROM notification_services').all() as any[];
    return services.map(service => ({
      ...service,
      config: JSON.parse(service.config)
    }));
  }

  createNotificationService(name: string, type: string, config: object): any {
    const result = this.db.run('INSERT INTO notification_services (name, type, config) VALUES (?, ?, ?)', [name, type, JSON.stringify(config)]);
    return { id: result.lastInsertRowid, name, type, config };
  }

  updateNotificationService(id: number, name: string, type: string, config: object): any {
    this.db.run('UPDATE notification_services SET name = ?, type = ?, config = ? WHERE id = ?', [name, type, JSON.stringify(config), id]);
    return { id, name, type, config };
  }

  deleteNotificationService(id: number): void {
    this.db.run('DELETE FROM notification_services WHERE id = ?', [id]);
  }

  getEndpointNotificationServices(endpointId: number): any[] {
    const services = this.db.query(
      `SELECT ns.* FROM notification_services ns
       JOIN monitor_notification_services mns ON ns.id = mns.notification_service_id
       WHERE mns.monitor_id = ?`
    ).all(endpointId) as any[];
    return services.map(service => ({
      ...service,
      config: JSON.parse(service.config)
    }));
  }

  addNotificationServiceToEndpoint(endpointId: number, serviceId: number): void {
    this.db.run('INSERT INTO monitor_notification_services (monitor_id, notification_service_id) VALUES (?, ?)', [endpointId, serviceId]);
  }

  removeNotificationServiceFromEndpoint(endpointId: number, serviceId: number): void {
    this.db.run('DELETE FROM monitor_notification_services WHERE monitor_id = ? AND notification_service_id = ?', [endpointId, serviceId]);
  }
}
