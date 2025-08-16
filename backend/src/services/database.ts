import { Database } from 'bun:sqlite';
import { stat } from 'fs/promises';
import { DB_PATH } from '../config/constants';
import { LoggerService } from './logger';

export class DatabaseService {
  constructor(
    private db: Database,
    private logger: LoggerService
  ) {}

  async getStats() {
    try {
      // Get database file size
      const dbFile = Bun.file(DB_PATH);
      const dbSizeBytes = await dbFile.size;
      const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);
      
      // Get table information
      const tables = this.db.query(`
        SELECT name 
        FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as any[];

      const tableStats = tables.map(table => {
        try {
          // Get row count for each table
          const rowCount = this.db.query(`SELECT COUNT(*) as count FROM "${table.name}"`).get() as any;
          
          // Calculate approximate table size (this is an estimation)
          // SQLite doesn't provide exact table sizes easily, so we estimate based on page count
          const tableInfo = this.db.query(`PRAGMA table_info("${table.name}")`).all() as any[];
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
      this.logger.error(`Error getting database stats: ${error}`, 'DATABASE');
      return {
        size: 'Unknown',
        tables: []
      };
    }
  }

  async vacuum() {
    try {
      // Run VACUUM command to optimize database
      this.db.exec('VACUUM');
      this.logger.info('Database vacuum completed successfully', 'DATABASE');
      return { success: true, message: 'Database vacuum completed successfully' };
    } catch (error) {
      this.logger.error(`Database vacuum failed: ${error}`, 'DATABASE');
      throw new Error(`Database vacuum failed: ${error}`);
    }
  }
}
