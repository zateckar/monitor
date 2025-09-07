import { Database } from 'bun:sqlite';
import { ConfigurationService } from './configuration';
import { LoggerService } from './logger';
import type {
  InstanceRegistration,
  HeartbeatPayload,
  MonitoringResult,
  Endpoint,
  MonitoringInstance,
  SystemInfo,
  ConnectionInfo
} from '../types';
import jwt from 'jsonwebtoken';

export class SynchronizationService {
  private authToken?: string;
  private heartbeatTimer?: NodeJS.Timeout;
  private isRunning = false;
  private lastHeartbeatSuccess?: Date;
  private heartbeatFailures = 0;
  private pendingHeartbeatSend = false;
  private pendingResults: MonitoringResult[] = [];

  constructor(
    private db: Database,
    private configService: ConfigurationService,
    private logger: LoggerService
  ) {}

  // Dependent instance methods

  async registerWithPrimary(): Promise<void> {
    const primaryURL = this.configService.getPrimarySyncURL();
    if (!primaryURL) {
      throw new Error('Primary sync URL not configured');
    }

    const sharedSecret = this.configService.getSharedSecret();
    if (!sharedSecret) {
      throw new Error('Shared secret not configured');
    }

    const registration: InstanceRegistration = {
      instanceId: this.configService.getInstanceId(),
      instanceName: this.configService.getInstanceName(),
      location: this.configService.getInstanceLocation(),
      version: '1.0.0',
      capabilities: ['monitoring', 'heartbeat'],
      failoverOrder: this.configService.getFailoverOrder(),
      systemInfo: this.getSystemInfo()
    };

    this.logger.info(`Attempting to register with primary at: ${primaryURL}`, 'SYNC');

    try {
      // Test basic connectivity first
      const healthResponse = await fetch(`${primaryURL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (!healthResponse.ok) {
        throw new Error(`Primary health check failed: ${healthResponse.status}`);
      }

      this.logger.info('Primary health check passed, proceeding with registration...', 'SYNC');

      const response = await fetch(`${primaryURL}/api/sync/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...registration,
          sharedSecret
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Registration failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { success: boolean; token?: string; error?: string };
      if (!result.success) {
        throw new Error(`Registration rejected: ${result.error}`);
      }

      this.authToken = result.token;
      this.logger.info('Successfully registered with primary', 'SYNC');

      // Store the token for future use
      this.storeAuthToken(result.token!);

    } catch (error) {
      this.logger.error(`Registration failed: ${error}`, 'SYNC');
      throw error;
    }
  }

  async fetchEndpointsFromPrimary(): Promise<Endpoint[]> {
    const primaryURL = this.configService.getPrimarySyncURL();
    if (!primaryURL || !this.authToken) {
      throw new Error('Not registered with primary or missing auth token');
    }

    try {
      const response = await fetch(`${primaryURL}/api/sync/endpoints`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token might be expired, try to re-register
          this.logger.warn('Auth token expired, attempting re-registration', 'SYNC');
          await this.registerWithPrimary();
          return this.fetchEndpointsFromPrimary();
        }
        throw new Error(`Failed to fetch endpoints: ${response.status}`);
      }

      const result = await response.json() as { success: boolean; data?: Endpoint[]; error?: string };
      if (!result.success) {
        throw new Error(`Endpoint fetch failed: ${result.error}`);
      }

      this.logger.info(`Fetched ${result.data!.length} endpoints from primary`, 'SYNC');
      return result.data!;

    } catch (error) {
      this.logger.error(`Failed to fetch endpoints: ${error}`, 'SYNC');
      throw error;
    }
  }

  async startDependentMode(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Dependent mode already running', 'SYNC');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting dependent mode operations', 'SYNC');

    // Send initial heartbeat to establish connection
    setTimeout(() => this.sendHeartbeatIfNeeded(), 1000);
  }

  stopDependentMode(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.logger.info('Stopping dependent mode operations', 'SYNC');

    // Stop any pending heartbeat
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  // Primary instance methods

  async registerInstance(registration: InstanceRegistration): Promise<string> {
    const instanceId = registration.instanceId;

    // Generate JWT token for the instance
    const jwtSecret = this.getJWTSecret();
    const token = jwt.sign(
      {
        instanceId: registration.instanceId,
        instanceName: registration.instanceName,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
      },
      jwtSecret
    );

    // Store instance in database
    this.db.run(`
      INSERT OR REPLACE INTO monitoring_instances (
        instance_id, instance_name, location, sync_url, failover_order,
        status, capabilities, system_info, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      instanceId,
      registration.instanceName,
      registration.location || 'unknown',
      registration.publicEndpoint || null,
      registration.failoverOrder,
      JSON.stringify(registration.capabilities),
      JSON.stringify(registration.systemInfo)
    ]);

    // Store the token
    this.storeInstanceToken(instanceId, token);

    this.logger.info(`Registered new instance: ${registration.instanceName} (${instanceId})`, 'SYNC');
    return token;
  }

  async processHeartbeat(heartbeat: HeartbeatPayload): Promise<void> {
    const instanceId = heartbeat.instanceId;

    // Update instance status
    this.db.run(`
      UPDATE monitoring_instances
      SET last_heartbeat = ?, status = 'active', updated_at = CURRENT_TIMESTAMP, system_info = ?
      WHERE instance_id = ?
    `, [heartbeat.timestamp, JSON.stringify(heartbeat.systemMetrics), instanceId]);

    // Store monitoring results
    for (const result of heartbeat.monitoringResults) {
      this.db.run(`
        INSERT INTO monitoring_results (
          endpoint_id, instance_id, timestamp, is_ok, response_time,
          status, failure_reason, location, check_type, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        result.endpointId,
        result.instanceId,
        result.timestamp,
        result.isOk ? 1 : 0,
        result.responseTime,
        result.status,
        result.failureReason || null,
        result.location,
        result.checkType,
        result.metadata ? JSON.stringify(result.metadata) : null
      ]);

      // Update aggregated results
      try {
        const existing = this.db.query('SELECT * FROM aggregated_results WHERE endpoint_id = ?').get(result.endpointId) as any;
        if (existing) {
          const locationResults = JSON.parse(existing.location_results);
          const existingResult = locationResults.find((r: any) => r.instanceId === result.instanceId);
          if (existingResult) {
            existingResult.status = result.status;
            existingResult.responseTime = result.responseTime;
          } else {
            locationResults.push({ instanceId: result.instanceId, status: result.status, responseTime: result.responseTime, location: result.location });
          }

          const successfulLocations = locationResults.filter((r: any) => r.status === 'UP').length;
          const totalLocations = locationResults.length;
          const consensusStatus = successfulLocations === totalLocations ? 'UP' : successfulLocations === 0 ? 'DOWN' : 'PARTIAL';
          const avgResponseTime = locationResults.reduce((acc: number, r: any) => acc + r.responseTime, 0) / totalLocations;

          this.db.run(`
            UPDATE aggregated_results
            SET total_locations = ?, successful_locations = ?, avg_response_time = ?, consensus_status = ?, location_results = ?
            WHERE endpoint_id = ?
          `, [totalLocations, successfulLocations, avgResponseTime, consensusStatus, JSON.stringify(locationResults), result.endpointId]);
        } else {
          const locationResults = [{ instanceId: result.instanceId, status: result.status, responseTime: result.responseTime, location: result.location }];
          const successfulLocations = result.isOk ? 1 : 0;
          const totalLocations = 1;
          const consensusStatus = result.isOk ? 'UP' : 'DOWN';
          const avgResponseTime = result.responseTime;

          this.db.run(`
            INSERT INTO aggregated_results (endpoint_id, total_locations, successful_locations, avg_response_time, consensus_status, location_results)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [result.endpointId, totalLocations, successfulLocations, avgResponseTime, consensusStatus, JSON.stringify(locationResults)]);
        }
      } catch (error) {
        this.logger.error(`Failed to process aggregated results for endpoint ${result.endpointId}: ${error}`, 'SYNC');
      }
    }

    // Update connection info
    this.db.run(`
      INSERT OR REPLACE INTO instance_config (key, value)
      VALUES (?, ?)
    `, [
      `connection_${instanceId}`,
      JSON.stringify(heartbeat.connectionStatus)
    ]);

    this.logger.debug(`Processed heartbeat from ${instanceId}`, 'SYNC');
  }

  async getEndpointsForSync(): Promise<Endpoint[]> {
    const endpoints = this.db.query('SELECT * FROM endpoints WHERE paused = 0').all() as Endpoint[];
    this.logger.debug(`Returning ${endpoints.length} endpoints for sync`, 'SYNC');
    return endpoints;
  }

  async getRegisteredInstances(): Promise<MonitoringInstance[]> {
    const instances = this.db.query(`
      SELECT * FROM monitoring_instances
      ORDER BY failover_order, created_at
    `).all() as MonitoringInstance[];

    return instances;
  }

  async unregisterInstance(instanceId: string): Promise<void> {
    this.db.run('DELETE FROM monitoring_instances WHERE instance_id = ?', [instanceId]);
    this.db.run('DELETE FROM instance_config WHERE key LIKE ?', [`%_${instanceId}`]);
    this.db.run('DELETE FROM instance_tokens WHERE instance_id = ?', [instanceId]);

    this.logger.info(`Unregistered instance: ${instanceId}`, 'SYNC');
  }

  async getFailoverOrder(): Promise<{ instanceId: string; order: number }[]> {
    const instances = this.db.query(`
      SELECT instance_id, failover_order
      FROM monitoring_instances
      WHERE status IN ('active', 'promoting')
      ORDER BY failover_order
    `).all() as any[];

    return instances.map(inst => ({
      instanceId: inst.instance_id,
      order: inst.failover_order
    }));
  }

  // Public getters for API access
  getAuthToken(): string | undefined {
    return this.authToken;
  }

  getLastHeartbeatSuccess(): Date | undefined {
    return this.lastHeartbeatSuccess;
  }

  getHeartbeatFailures(): number {
    return this.heartbeatFailures;
  }

  getConnectionStatusPublic(): ConnectionInfo {
    return this.getConnectionStatus();
  }

  // Health checking methods

  async isPrimaryReachable(): Promise<boolean> {
    const primaryURL = this.configService.getPrimarySyncURL();
    if (!primaryURL) {
      return false;
    }

    try {
      const response = await fetch(`${primaryURL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      const reachable = response.ok;
      if (reachable) {
        this.lastHeartbeatSuccess = new Date();
        this.heartbeatFailures = 0;
      } else {
        this.heartbeatFailures++;
      }

      return reachable;
    } catch (error) {
      this.heartbeatFailures++;
      this.logger.debug(`Primary reachability check failed: ${error}`, 'SYNC');
      return false;
    }
  }

  // Event-driven heartbeat methods

  async collectMonitoringResult(result: MonitoringResult): Promise<void> {
    // Add result to pending collection
    this.pendingResults.push(result);

    // Trigger heartbeat with debouncing
    await this.triggerHeartbeat();
  }

  async triggerHeartbeat(): Promise<void> {
    if (!this.isRunning || this.pendingHeartbeatSend) {
      return;
    }

    this.pendingHeartbeatSend = true;

    // Debounce heartbeats - wait 2 seconds before sending to batch multiple results
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }

    this.heartbeatTimer = setTimeout(async () => {
      try {
        await this.sendHeartbeatIfNeeded();
      } catch (error) {
        this.logger.error(`Heartbeat failed: ${error}`, 'SYNC');
      } finally {
        this.pendingHeartbeatSend = false;
      }
    }, 2000); // 2 second debounce
  }

  private async sendHeartbeatIfNeeded(): Promise<void> {
    // Only send heartbeat if we have results to send
    if (this.pendingResults.length === 0) {
      this.logger.debug('No pending results to send, skipping heartbeat', 'SYNC');
      return;
    }

    await this.sendHeartbeat();
  }

  private async sendHeartbeat(): Promise<void> {
    const primaryURL = this.configService.getPrimarySyncURL();
    if (!primaryURL || !this.authToken) {
      this.logger.warn('Cannot send heartbeat: missing primary URL or auth token', 'SYNC');
      return;
    }

    // Use collected pending results
    const resultsToSend = [...this.pendingResults];
    this.pendingResults = []; // Clear pending results

    const systemMetrics = await this.getSystemMetrics();

    const heartbeat: HeartbeatPayload = {
      instanceId: this.configService.getInstanceId(),
      timestamp: new Date().toISOString(),
      status: 'healthy',
      uptime: process.uptime(),
      monitoringResults: resultsToSend,
      systemMetrics,
      connectionStatus: this.getConnectionStatus()
    };

    // Log the heartbeat payload for debugging
    this.logger.debug(`Sending heartbeat payload: ${JSON.stringify(heartbeat, null, 2)}`, 'SYNC');

    try {
      const response = await fetch(`${primaryURL}/api/sync/heartbeat`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(heartbeat),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        // Log the response details for debugging
        const responseText = await response.text();
        this.logger.error(`Heartbeat failed with status ${response.status}: ${responseText}`, 'SYNC');

        if (response.status === 401) {
          // Token expired, try to re-register
          this.logger.warn('Heartbeat auth failed, attempting re-registration', 'SYNC');
          await this.registerWithPrimary();
          return;
        }
        throw new Error(`Heartbeat failed: ${response.status}`);
      }

      this.lastHeartbeatSuccess = new Date();
      this.heartbeatFailures = 0;

      this.logger.debug(`Heartbeat sent successfully with ${resultsToSend.length} results`, 'SYNC');

    } catch (error) {
      this.heartbeatFailures++;
      this.logger.error(`Heartbeat send failed: ${error}`, 'SYNC');
      throw error;
    }
  }


  private async getSystemMetrics(): Promise<{ cpuUsage: number; memoryUsage: number; diskUsage: number; activeEndpoints: number }> {
    // Get basic system metrics
    const memUsage = process.memoryUsage();
    const activeEndpoints = await this.configService.getSystemMetrics().then(metrics => metrics.activeEndpoints);

    return {
      cpuUsage: 0, // Would need additional library for CPU usage - set to 0 for now
      memoryUsage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100), // Convert to percentage
      diskUsage: 0, // Would need additional library for disk usage - set to 0 for now
      activeEndpoints
    };
  }

  private getConnectionStatus(): ConnectionInfo {
    return {
      primaryReachable: this.lastHeartbeatSuccess ? (Date.now() - this.lastHeartbeatSuccess.getTime()) < 300000 : false, // 5 minutes
      lastSyncSuccess: this.lastHeartbeatSuccess?.toISOString(),
      syncErrors: this.heartbeatFailures,
      latency: 0 // Would need to measure actual latency
    };
  }

  private getSystemInfo(): SystemInfo {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      memory: require('os').totalmem(),
      cpu: require('os').cpus().length,
      uptime: process.uptime()
    };
  }

  private getJWTSecret(): string {
    // Get or create JWT secret
    const existing = this.db.query('SELECT value FROM instance_config WHERE key = ?').get('jwtSecret') as any;
    if (existing?.value) {
      return existing.value;
    }

    // Generate a new secret
    const crypto = require('crypto');
    const secret = crypto.randomBytes(32).toString('hex');

    this.db.run('INSERT OR REPLACE INTO instance_config (key, value) VALUES (?, ?)', ['jwtSecret', secret]);
    return secret;
  }

  private storeAuthToken(token: string): void {
    // Store token in memory for now - could also persist to database
    this.authToken = token;
  }

  private storeInstanceToken(instanceId: string, token: string): void {
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    this.db.run(`
      INSERT OR REPLACE INTO instance_tokens (
        instance_id, token_hash, created_at, permissions
      ) VALUES (?, ?, CURRENT_TIMESTAMP, ?)
    `, [
      instanceId,
      tokenHash,
      JSON.stringify(['sync', 'heartbeat'])
    ]);
  }
}