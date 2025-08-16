import { Elysia } from 'elysia';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../services/database';
import { LoggerService } from '../services/logger';

export function createSystemRoutes(
  db: Database,
  databaseService: DatabaseService,
  logger: LoggerService
) {
  return new Elysia({ prefix: '/api' })
    .get('/logs', async () => {
      const logs = db.query('SELECT * FROM application_logs ORDER BY timestamp DESC LIMIT 1000').all() as any[];
      return logs;
    })
    .delete('/logs', async () => {
      db.run('DELETE FROM application_logs');
      logger.info('Application logs cleared by admin', 'SYSTEM');
      return { success: true };
    })
    .get('/logs/level', async () => {
      const level = logger.getLogLevel();
      return { level };
    })
    .put('/logs/level', async ({ body }) => {
      const { level } = body as { level: string };
      try {
        logger.setLogLevel(level);
        logger.info(`Log level changed to: ${level}`, 'SYSTEM');
        return { level };
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: error instanceof Error ? error.message : 'Failed to set log level' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    })
    .get('/database/stats', async () => {
      return await databaseService.getStats();
    })
    .post('/database/vacuum', async () => {
      try {
        return await databaseService.vacuum();
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Database vacuum failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    });
}
