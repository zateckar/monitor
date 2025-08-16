import { Database } from 'bun:sqlite';

export class LoggerService {
  private currentLogLevel = 'warn'; // Default to warn instead of debug
  private logLevels = { debug: 0, info: 1, warn: 2, error: 3 };

  constructor(private db: Database) {
    this.loadLogLevelFromDatabase();
  }

  private loadLogLevelFromDatabase(): void {
    try {
      const result = this.db.query('SELECT value FROM system_settings WHERE key = ?').get('log_level') as any;
      console.log('Database query result for log_level:', result);
      if (result && result.value) {
        this.currentLogLevel = result.value;
        console.log('Loaded log level from database:', result.value);
      } else {
        console.log('No log level found in database, using default:', this.currentLogLevel);
      }
    } catch (err) {
      // If there's an error loading from database, keep the default level
      console.warn('Failed to load log level from database, using default:', err);
    }
  }

  setLogLevel(level: string): void {
    if (!this.logLevels.hasOwnProperty(level)) {
      throw new Error(`Invalid log level: ${level}. Must be one of: ${Object.keys(this.logLevels).join(', ')}`);
    }
    
    console.log(`Setting log level from ${this.currentLogLevel} to ${level}`);
    this.currentLogLevel = level;
    
    // Persist to database
    try {
      this.db.run(
        'INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['log_level', level]
      );
      console.log(`Successfully persisted log level ${level} to database`);
      
      // Verify the save by reading it back
      const verification = this.db.query('SELECT value FROM system_settings WHERE key = ?').get('log_level') as any;
      console.log('Verification read from database:', verification);
    } catch (err) {
      console.error('Failed to persist log level to database:', err);
    }
  }

  getLogLevel(): string {
    console.log('getLogLevel() called, returning:', this.currentLogLevel);
    // Also check what's actually in the database right now
    try {
      const dbResult = this.db.query('SELECT value FROM system_settings WHERE key = ?').get('log_level') as any;
      console.log('Current database value for log_level:', dbResult);
    } catch (err) {
      console.log('Error checking database:', err);
    }
    return this.currentLogLevel;
  }

  private async log(level: string, message: string, component?: string): Promise<void> {
    // Only log if the level meets the current threshold
    if (this.logLevels[level as keyof typeof this.logLevels] >= this.logLevels[this.currentLogLevel as keyof typeof this.logLevels]) {
      // Log to console
      console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${component ? `[${component}] ` : ''}${message}`);
      
      // Log to database (with error handling to avoid infinite loops)
      try {
        this.db.run(
          'INSERT INTO application_logs (level, message, component) VALUES (?, ?, ?)',
          [level, message, component || null]
        );
      } catch (err) {
        console.error('Failed to write log to database:', err);
      }
    }
  }

  debug(message: string, component?: string): Promise<void> {
    return this.log('debug', message, component);
  }

  info(message: string, component?: string): Promise<void> {
    return this.log('info', message, component);
  }

  warn(message: string, component?: string): Promise<void> {
    return this.log('warn', message, component);
  }

  error(message: string, component?: string): Promise<void> {
    return this.log('error', message, component);
  }

  getLogs(limit: number = 1000): any[] {
    return this.db.query('SELECT * FROM application_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
  }

  clearLogs(): void {
    this.db.run('DELETE FROM application_logs');
  }
}
