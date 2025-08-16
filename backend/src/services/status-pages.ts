import { Database } from 'bun:sqlite';
import { LoggerService } from './logger';
import { calculateGapAwareUptime } from '../utils/uptime';

export class StatusPageService {
  constructor(
    private db: Database,
    private logger: LoggerService
  ) {}

  getAll(): any[] {
    const statusPages = this.db.query('SELECT * FROM status_pages ORDER BY created_at DESC').all() as any[];
    return statusPages.map(page => ({
      ...page,
      is_public: Boolean(page.is_public),
      monitor_ids: JSON.parse(page.monitor_ids)
    }));
  }

  async create(data: {
    name: string;
    slug: string;
    description?: string;
    is_public: boolean;
    monitor_ids: number[];
  }): Promise<any> {
    const { name, slug, description, is_public, monitor_ids } = data;

    if (!name || !slug) {
      throw new Error('Name and slug are required');
    }

    if (!monitor_ids || monitor_ids.length === 0) {
      throw new Error('At least one monitor must be selected');
    }

    // Check if slug already exists
    const existingPage = this.db.query('SELECT id FROM status_pages WHERE slug = ?').get(slug) as any;
    if (existingPage) {
      throw new Error('Slug already exists');
    }

    const result = this.db.run(
      'INSERT INTO status_pages (name, slug, description, is_public, monitor_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [name, slug, description || null, is_public ? 1 : 0, JSON.stringify(monitor_ids)]
    );

    const newPage = this.db.query('SELECT * FROM status_pages WHERE id = ?').get(result.lastInsertRowid) as any;
    
    this.logger.info(`Created status page "${name}" with slug "${slug}"`, 'STATUS_PAGES');

    return {
      ...newPage,
      is_public: Boolean(newPage.is_public),
      monitor_ids: JSON.parse(newPage.monitor_ids)
    };
  }

  async update(id: number, data: {
    name: string;
    slug: string;
    description?: string;
    is_public: boolean;
    monitor_ids: number[];
  }): Promise<any> {
    const { name, slug, description, is_public, monitor_ids } = data;

    if (!name || !slug) {
      throw new Error('Name and slug are required');
    }

    if (!monitor_ids || monitor_ids.length === 0) {
      throw new Error('At least one monitor must be selected');
    }

    // Check if page exists
    const existingPage = this.db.query('SELECT * FROM status_pages WHERE id = ?').get(id) as any;
    if (!existingPage) {
      throw new Error('Status page not found');
    }

    // Check if slug already exists (but allow the same slug if it's the current page)
    const slugExists = this.db.query('SELECT id FROM status_pages WHERE slug = ? AND id != ?').get(slug, id) as any;
    if (slugExists) {
      throw new Error('Slug already exists');
    }

    this.db.run(
      'UPDATE status_pages SET name = ?, slug = ?, description = ?, is_public = ?, monitor_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, slug, description || null, is_public ? 1 : 0, JSON.stringify(monitor_ids), id]
    );

    const updatedPage = this.db.query('SELECT * FROM status_pages WHERE id = ?').get(id) as any;
    
    this.logger.info(`Updated status page "${name}" (ID: ${id})`, 'STATUS_PAGES');

    return {
      ...updatedPage,
      is_public: Boolean(updatedPage.is_public),
      monitor_ids: JSON.parse(updatedPage.monitor_ids)
    };
  }

  async delete(id: number): Promise<boolean> {
    // Check if page exists
    const existingPage = this.db.query('SELECT name FROM status_pages WHERE id = ?').get(id) as any;
    if (!existingPage) {
      throw new Error('Status page not found');
    }

    this.db.run('DELETE FROM status_pages WHERE id = ?', [id]);
    
    this.logger.info(`Deleted status page "${existingPage.name}" (ID: ${id})`, 'STATUS_PAGES');

    return true;
  }

  async getPublicStatusPage(slug: string): Promise<any> {
    // Get status page
    const statusPage = this.db.query('SELECT * FROM status_pages WHERE slug = ? AND is_public = 1').get(slug) as any;
    if (!statusPage) {
      throw new Error('Status page not found');
    }

    // Get monitors for this status page
    const monitorIds = JSON.parse(statusPage.monitor_ids);
    const monitors = await Promise.all(
      monitorIds.map(async (id: number) => {
        const endpoint = this.db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as any;
        if (!endpoint) return null;

        // Get recent stats for public display
        const stats24h = await calculateGapAwareUptime(this.db, endpoint.id, endpoint.heartbeat_interval || 60, '1 day');
        const stats30d = await calculateGapAwareUptime(this.db, endpoint.id, endpoint.heartbeat_interval || 60, '30 days');

        return {
          id: endpoint.id,
          name: endpoint.name,
          url: endpoint.url,
          status: endpoint.status,
          uptime_24h: stats24h?.uptime || 0,
          uptime_30d: stats30d?.uptime || 0,
          last_checked: endpoint.last_checked
        };
      })
    );

    return {
      ...statusPage,
      is_public: Boolean(statusPage.is_public),
      monitor_ids: monitorIds,
      monitors: monitors.filter(m => m !== null)
    };
  }
}
