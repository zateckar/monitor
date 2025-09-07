import { Database } from 'bun:sqlite';
import type { InstanceConfig, MonitoringInstance } from '../types';
import { LoggerService } from './logger';
import crypto from 'crypto';
import os from 'os';

export class ConfigurationService {
  private config!: InstanceConfig;
  private instanceId: string;
  
  constructor(
    private db: Database,
    private logger: LoggerService
  ) {
    this.loadConfiguration();
    this.instanceId = this.generateOrGetInstanceId();
  }

  private loadConfiguration(): void {
    // Load configuration from environment variables and database
    this.config = {
      primarySyncURL: process.env.PRIMARY_SYNC_URL || undefined,
      instanceName: process.env.INSTANCE_NAME || `monitor-${os.hostname()}`,
      instanceLocation: process.env.INSTANCE_LOCATION || undefined,
      sharedSecret: process.env.SHARED_SECRET || undefined,
      failoverOrder: parseInt(process.env.FAILOVER_ORDER || '99'),
      syncInterval: parseInt(process.env.SYNC_INTERVAL || '30'),
      heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000'),
      connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '30000'),
    };

    // Override with database settings if they exist
    this.loadDatabaseConfig();
  }

  private loadDatabaseConfig(): void {
    try {
      const configRows = this.db.query('SELECT key, value FROM instance_config').all() as any[];

      for (const row of configRows) {
        switch (row.key) {
          case 'primarySyncURL':
            this.config.primarySyncURL = row.value || undefined;
            break;
          case 'instanceName':
            this.config.instanceName = row.value;
            break;
          case 'instanceLocation':
            this.config.instanceLocation = row.value || undefined;
            break;
          case 'failoverOrder':
            this.config.failoverOrder = parseInt(row.value);
            break;
          case 'syncInterval':
            this.config.syncInterval = parseInt(row.value);
            break;
          case 'heartbeatInterval':
            this.config.heartbeatInterval = parseInt(row.value);
            break;
          case 'connectionTimeout':
            this.config.connectionTimeout = parseInt(row.value);
            break;
          case 'sharedSecret':
            this.config.sharedSecret = row.value || undefined;
            break;
        }
      }
    } catch (error) {
      this.logger.debug('No database configuration found, using environment/defaults', 'CONFIG');
    }
  }

  private generateOrGetInstanceId(): string {
    try {
      // Try to get existing instance ID from database
      const existing = this.db.query('SELECT value FROM instance_config WHERE key = ?').get('instanceId') as any;
      if (existing?.value) {
        return existing.value;
      }
    } catch (error) {
      // Table might not exist yet, continue to generate new ID
    }

    // Generate new instance ID
    const instanceId = crypto.randomUUID();
    
    try {
      // Store the instance ID
      this.db.run(
        'INSERT OR REPLACE INTO instance_config (key, value, description) VALUES (?, ?, ?)',
        ['instanceId', instanceId, 'Unique identifier for this monitoring instance']
      );
    } catch (error) {
      this.logger.warn(`Failed to store instance ID: ${error}`, 'CONFIG');
    }

    return instanceId;
  }

  getInstanceRole(): 'primary' | 'dependent' | 'standalone' {
    if (this.config.primarySyncURL) {
      return 'dependent';
    }
    // Check if we're configured as primary via environment or database flag
    const isPrimaryFlag = process.env.INSTANCE_ROLE === 'primary' || this.isPrimaryFlagSet();
    if (isPrimaryFlag) {
      return 'primary';
    }
    return 'standalone';
  }

  private isPrimaryFlagSet(): boolean {
    try {
      const result = this.db.query('SELECT value FROM instance_config WHERE key = ?').get('instanceRole') as any;
      return result?.value === 'primary';
    } catch (error) {
      return false;
    }
  }

  isPrimary(): boolean {
    return this.getInstanceRole() === 'primary';
  }

  isDependent(): boolean {
    return this.getInstanceRole() === 'dependent';
  }

  isStandalone(): boolean {
    return this.getInstanceRole() === 'standalone';
  }

  getConfig(): InstanceConfig {
    return { ...this.config };
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  getInstanceName(): string {
    return this.config.instanceName;
  }

  getInstanceLocation(): string {
    return this.config.instanceLocation || 'unknown';
  }

  getPrimarySyncURL(): string | undefined {
    return this.config.primarySyncURL;
  }

  getSyncAPIPort(): number {
    // Always use the main application port
    return parseInt(process.env.PORT || '3001');
  }

  getFailoverOrder(): number {
    return this.config.failoverOrder || 99;
  }

  getSyncInterval(): number {
    return this.config.syncInterval || 30;
  }

  getHeartbeatInterval(): number {
    return this.config.heartbeatInterval || 30000;
  }

  getConnectionTimeout(): number {
    return this.config.connectionTimeout || 30000;
  }

  getSharedSecret(): string | undefined {
    try {
      const result = this.db.query('SELECT value FROM instance_config WHERE key = ?').get('sharedSecret') as any;
      return result?.value;
    } catch (error) {
      return undefined;
    }
  }

  async setSharedSecret(secret: string): Promise<void> {
    try {
      this.db.run(
        'INSERT OR REPLACE INTO instance_config (key, value, description, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        ['sharedSecret', secret, 'Shared secret for instance registration authentication']
      );
      this.logger.info('Shared secret updated successfully', 'CONFIG');
    } catch (error) {
      this.logger.error(`Failed to update shared secret: ${error}`, 'CONFIG');
      throw error;
    }
  }

  async generateSharedSecret(): Promise<string> {
    const secret = crypto.randomBytes(32).toString('hex');
    await this.setSharedSecret(secret);
    this.logger.info('Generated new shared secret', 'CONFIG');
    return secret;
  }

  async updateConfig(updates: Partial<InstanceConfig>): Promise<void> {
    // Update in-memory config
    this.config = { ...this.config, ...updates };

    // Store updates in database
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        try {
          this.db.run(
            'INSERT OR REPLACE INTO instance_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [key, String(value)]
          );
          this.logger.info(`Updated configuration: ${key} = ${value}`, 'CONFIG');
        } catch (error) {
          this.logger.error(`Failed to update configuration ${key}: ${error}`, 'CONFIG');
        }
      }
    }
  }

  async promoteToPrimary(): Promise<void> {
    await this.updateConfig({
      primarySyncURL: undefined
    });
    
    // Set primary flag in database
    try {
      this.db.run(
        'INSERT OR REPLACE INTO instance_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        ['instanceRole', 'primary']
      );
    } catch (error) {
      this.logger.error(`Failed to set primary flag: ${error}`, 'CONFIG');
    }
    
    this.logger.info(`Instance ${this.instanceId} promoted to PRIMARY role`, 'CONFIG');
  }

  async demoteToDependent(primaryURL: string): Promise<void> {
    await this.updateConfig({
      primarySyncURL: primaryURL
    });
    
    // Remove primary flag from database
    try {
      this.db.run('DELETE FROM instance_config WHERE key = ?', ['instanceRole']);
    } catch (error) {
      this.logger.error(`Failed to remove primary flag: ${error}`, 'CONFIG');
    }
    
    this.logger.info(`Instance ${this.instanceId} demoted to DEPENDENT role, primary: ${primaryURL}`, 'CONFIG');
  }

  getSystemInfo(): any {
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      memory: os.totalmem(),
      cpu: os.cpus().length,
      uptime: process.uptime(),
      hostname: os.hostname(),
      loadavg: os.loadavg(),
      freemem: os.freemem()
    };
  }

  async getSystemMetrics(): Promise<any> {
    const memUsage = process.memoryUsage();
    const loadavg = os.loadavg();
    const activeEndpoints = await this.getActiveEndpointCount();
    
    return {
      cpuUsage: loadavg[0], // 1-minute load average as CPU usage approximation
      memoryUsage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      diskUsage: 0, // TODO: Implement disk usage calculation
      uptime: process.uptime(),
      activeEndpoints
    };
  }

  private async getActiveEndpointCount(): Promise<number> {
    try {
      const result = this.db.query('SELECT COUNT(*) as count FROM endpoints WHERE paused = 0').get() as any;
      return result?.count || 0;
    } catch (error) {
      return 0;
    }
  }

  validateConfiguration(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate instance name
    if (!this.config.instanceName || this.config.instanceName.trim().length === 0) {
      errors.push('Instance name is required');
    }

    // Validate role configuration
    if (this.isPrimary() && this.config.primarySyncURL) {
      errors.push('Cannot be both primary and dependent (primarySyncURL)');
    }

    // Validate primary sync URL format
    if (this.config.primarySyncURL) {
      try {
        new URL(this.config.primarySyncURL);
      } catch (error) {
        errors.push('Invalid primary sync URL format');
      }
    }

    // No need to validate syncAPIPort since we use the main app port

    if (this.config.failoverOrder && this.config.failoverOrder < 0) {
      errors.push('Failover order must be non-negative');
    }

    if (this.config.syncInterval && this.config.syncInterval < 10) {
      errors.push('Sync interval must be at least 10 seconds');
    }

    if (this.config.heartbeatInterval && this.config.heartbeatInterval < 30) {
      errors.push('Heartbeat interval must be at least 30 seconds');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async resetToStandalone(): Promise<void> {
    await this.updateConfig({
      primarySyncURL: undefined
    });
    
    // Remove primary flag from database
    try {
      this.db.run('DELETE FROM instance_config WHERE key = ?', ['instanceRole']);
    } catch (error) {
      this.logger.error(`Failed to remove primary flag: ${error}`, 'CONFIG');
    }
    
    this.logger.info(`Instance ${this.instanceId} reset to STANDALONE mode`, 'CONFIG');
  }

  logCurrentConfiguration(): void {
    const role = this.getInstanceRole().toUpperCase();
    this.logger.info(`=== INSTANCE CONFIGURATION ===`, 'CONFIG');
    this.logger.info(`Instance ID: ${this.instanceId}`, 'CONFIG');
    this.logger.info(`Instance Name: ${this.config.instanceName}`, 'CONFIG');
    this.logger.info(`Role: ${role}`, 'CONFIG');
    this.logger.info(`Location: ${this.config.instanceLocation || 'Not specified'}`, 'CONFIG');
    
    if (this.isPrimary()) {
      this.logger.info(`Sync API enabled on main port: ${this.getSyncAPIPort()}`, 'CONFIG');
    }
    
    if (this.isDependent()) {
      this.logger.info(`Primary URL: ${this.config.primarySyncURL}`, 'CONFIG');
      this.logger.info(`Failover Order: ${this.config.failoverOrder}`, 'CONFIG');
      this.logger.info(`Sync Interval: ${this.config.syncInterval}s`, 'CONFIG');
      this.logger.info(`Heartbeat Interval: ${this.config.heartbeatInterval}s`, 'CONFIG');
    }
    
    this.logger.info(`==============================`, 'CONFIG');
  }
}