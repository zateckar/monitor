import { Database } from 'bun:sqlite';
import { MonitoringService } from './monitoring';
import { ConfigurationService } from './configuration';
import { SynchronizationService } from './synchronization';
import { FailoverManager } from './failover';
import { LoggerService } from './logger';
import { KafkaService } from './kafka';
import { DomainInfoService } from './domain-info';
import { CertificateService } from './certificate';
import type { Endpoint, MonitoringResult } from '../types';
import type { IMonitoringService } from '../types/monitoring';

export class DistributedMonitoringService implements IMonitoringService {
  private pendingResults: MonitoringResult[] = [];
  private lastSyncTime = new Date();
  private syncedEndpoints = new Map<number, Endpoint>();
  private localEndpoints = new Map<number, Endpoint>();
  private monitoringService: MonitoringService;

  constructor(
    private db: Database,
    private logger: LoggerService,
    kafkaService: KafkaService,
    domainInfoService: DomainInfoService,
    certificateService: CertificateService,
    private sendNotification: (endpoint: Endpoint, status: string) => Promise<void>,
    private configService: ConfigurationService,
    private syncService: SynchronizationService,
    private failoverManager: FailoverManager
  ) {
    this.monitoringService = new MonitoringService(
      db,
      logger,
      kafkaService,
      domainInfoService,
      certificateService,
      this.wrapNotificationForDistributed.bind(this),
      this.collectMonitoringResult.bind(this)
    );
  }

  private async wrapNotificationForDistributed(endpoint: Endpoint, status: string): Promise<void> {
    // Only send notifications if we're primary or standalone
    // Dependent instances report to primary, which handles notifications
    if (!this.configService.isDependent()) {
      await this.sendNotification(endpoint, status);
    }
  }

  async initializeMonitoring(): Promise<void> {
    const role = this.configService.getInstanceRole();
    this.logger.info(`Initializing monitoring in ${role.toUpperCase()} mode`, 'DISTRIBUTED_MONITORING');

    try {
      switch (role) {
        case 'primary':
          await this.initializePrimaryMode();
          break;
        case 'dependent':
          await this.initializeDependentMode();
          break;
        case 'standalone':
          await this.initializeStandaloneMode();
          break;
      }
    } catch (error) {
      this.logger.error(`Failed to initialize ${role} monitoring mode: ${error}`, 'DISTRIBUTED_MONITORING');
      throw error;
    }
  }

  private async initializePrimaryMode(): Promise<void> {
    this.logger.info('Starting PRIMARY mode initialization', 'DISTRIBUTED_MONITORING');

    // 1. Start local monitoring
    await this.startLocalMonitoring();

    // 2. Sync API routes are now integrated with main application
    this.logger.info('Sync API routes enabled for primary instance', 'DISTRIBUTED_MONITORING');

    // 3. Start aggregation service
    this.startAggregationService();

    // 4. Start instance health monitoring
    this.startInstanceHealthMonitoring();

    this.logger.info('PRIMARY mode initialization completed', 'DISTRIBUTED_MONITORING');
  }

  private async initializeDependentMode(): Promise<void> {
    this.logger.info('Starting DEPENDENT mode initialization', 'DISTRIBUTED_MONITORING');

    try {
      // 1. Register with primary and get authentication token
      await this.syncService.registerWithPrimary();

      // 2. Fetch endpoints from primary
      const endpoints = await this.syncService.fetchEndpointsFromPrimary();
      await this.syncEndpointsFromPrimary(endpoints);

      // 3. Start monitoring synced endpoints
      await this.startSyncedEndpointsMonitoring();

      // 4. Start heartbeat reporting
      await this.syncService.startDependentMode();

      // 5. Start failover monitoring
      await this.failoverManager.startFailoverMonitoring();

      this.logger.info('DEPENDENT mode initialization completed', 'DISTRIBUTED_MONITORING');
    } catch (error) {
      this.logger.error(`DEPENDENT mode initialization failed: ${error}`, 'DISTRIBUTED_MONITORING');
      
      // Fall back to independent operation with cached endpoints
      this.logger.warn('Falling back to independent operation with local endpoints', 'DISTRIBUTED_MONITORING');
      await this.startLocalMonitoring();
      throw error;
    }
  }

  private async initializeStandaloneMode(): Promise<void> {
    this.logger.info('Starting STANDALONE mode initialization', 'DISTRIBUTED_MONITORING');
    
    // Just start local monitoring as usual
    await this.startLocalMonitoring();
    
    this.logger.info('STANDALONE mode initialization completed', 'DISTRIBUTED_MONITORING');
  }

  private async startLocalMonitoring(): Promise<void> {
    // Use the wrapped monitoring service for local endpoints
    await this.monitoringService.initializeMonitoring();
    
    // Track local endpoints
    const endpoints: Endpoint[] = this.db.query('SELECT * FROM endpoints').all() as Endpoint[];
    for (const endpoint of endpoints) {
      this.localEndpoints.set(endpoint.id, endpoint);
    }
  }

  private async syncEndpointsFromPrimary(endpoints: Endpoint[]): Promise<void> {
    this.logger.info(`Syncing ${endpoints.length} endpoints from primary`, 'DISTRIBUTED_MONITORING');

    // Stop monitoring any endpoints that are no longer in the sync list
    for (const [endpointId] of this.syncedEndpoints) {
      if (!endpoints.find(e => e.id === endpointId)) {
        this.stopEndpointMonitoring(endpointId);
        this.syncedEndpoints.delete(endpointId);
      }
    }

    // Update/add synced endpoints
    for (const endpoint of endpoints) {
      this.syncedEndpoints.set(endpoint.id, endpoint);
      
      // Update sync status
      this.db.run(`
        INSERT OR REPLACE INTO endpoint_sync_status (
          endpoint_id, instance_id, last_synced, config_hash, status
        ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'synced')
      `, [
        endpoint.id,
        this.configService.getInstanceId(),
        this.generateConfigHash(endpoint)
      ]);
    }

    this.lastSyncTime = new Date();
  }

  private async startSyncedEndpointsMonitoring(): Promise<void> {
    // Start monitoring all synced endpoints using the wrapped service
    for (const endpoint of this.syncedEndpoints.values()) {
      if (!endpoint.paused) {
        this.startEndpointMonitoring(endpoint);
      }
    }
    
    this.logger.info(`Started monitoring ${this.syncedEndpoints.size} synced endpoints`, 'DISTRIBUTED_MONITORING');
  }

  private generateConfigHash(endpoint: Endpoint): string {
    // Generate a hash of the endpoint configuration for change detection
    const crypto = require('crypto');
    const configString = JSON.stringify({
      url: endpoint.url,
      type: endpoint.type,
      heartbeat_interval: endpoint.heartbeat_interval,
      retries: endpoint.retries,
      // Add other relevant config fields
    });
    return crypto.createHash('md5').update(configString).digest('hex');
  }

  // Wrap the monitoring service methods with distributed logic
  async checkSingleEndpoint(endpoint: Endpoint): Promise<void> {
    // Call the wrapped monitoring service
    await this.monitoringService.checkSingleEndpoint(endpoint);

    // Collect results for API access (always, regardless of mode)
    await this.collectMonitoringResult(endpoint);

    // If we're a dependent instance, also collect for heartbeat reporting
    if (this.configService.isDependent()) {
      // Results are already collected above, just ensure they're in pendingResults
    }
  }

  private async collectMonitoringResult(endpoint: Endpoint): Promise<void> {
    try {
      // Get the latest result for this endpoint
      const latestResult = this.db.query(`
        SELECT * FROM response_times
        WHERE endpoint_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(endpoint.id) as any;

      if (latestResult) {
        // Normalize status to ensure it's always 'UP' or 'DOWN'
        const normalizedStatus = (latestResult.status === 'UP' || latestResult.status === 'DOWN')
          ? latestResult.status
          : 'DOWN'; // Default to 'DOWN' if status is invalid

        const monitoringResult: MonitoringResult = {
          endpointId: endpoint.id,
          instanceId: this.configService.getInstanceId(),
          timestamp: latestResult.created_at,
          isOk: normalizedStatus === 'UP',
          responseTime: latestResult.response_time,
          status: normalizedStatus,
          failureReason: latestResult.failure_reason || undefined, // Convert null to undefined
          location: this.configService.getInstanceLocation(),
          checkType: endpoint.type,
          metadata: latestResult.check_metadata ? JSON.parse(latestResult.check_metadata) : undefined
        };

        // Store for next heartbeat
        this.pendingResults.push(monitoringResult);

        // Insert into monitoring_results table for API access
        this.db.run(`
          INSERT INTO monitoring_results (
            endpoint_id, instance_id, timestamp, is_ok, response_time,
            status, failure_reason, location, check_type, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          monitoringResult.endpointId,
          monitoringResult.instanceId,
          monitoringResult.timestamp,
          monitoringResult.isOk ? 1 : 0,
          monitoringResult.responseTime,
          monitoringResult.status,
          monitoringResult.failureReason || null,
          monitoringResult.location,
          monitoringResult.checkType,
          monitoringResult.metadata ? JSON.stringify(monitoringResult.metadata) : null
        ]);

        // Update local response_times with instance info
        this.db.run(`
          UPDATE response_times
          SET instance_id = ?, location = ?
          WHERE id = (
            SELECT id FROM response_times
            WHERE endpoint_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          )
        `, [
          this.configService.getInstanceId(),
          this.configService.getInstanceLocation(),
          endpoint.id
        ]);

        // Send result to sync service for heartbeat if we're a dependent instance
        if (this.configService.isDependent()) {
          await this.syncService.collectMonitoringResult(monitoringResult);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to collect monitoring result for endpoint ${endpoint.id}: ${error}`, 'DISTRIBUTED_MONITORING');
    }
  }

  private startAggregationService(): void {
    // Aggregate results from all instances every 5 minutes
    setInterval(async () => {
      try {
        await this.aggregateInstanceResults();
      } catch (error) {
        this.logger.error(`Aggregation service error: ${error}`, 'DISTRIBUTED_MONITORING');
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Clean up old monitoring results every hour
    setInterval(async () => {
      try {
        await this.cleanupOldMonitoringResults();
      } catch (error) {
        this.logger.error(`Monitoring results cleanup error: ${error}`, 'DISTRIBUTED_MONITORING');
      }
    }, 60 * 60 * 1000); // 1 hour

    this.logger.info('Started aggregation service', 'DISTRIBUTED_MONITORING');
  }

  private async aggregateInstanceResults(): Promise<void> {
    // Get all active endpoints
    const endpoints: Endpoint[] = this.db.query('SELECT * FROM endpoints').all() as Endpoint[];
    
    for (const endpoint of endpoints) {
      // Get recent results from all instances for this endpoint
      const recentResults = this.db.query(`
        SELECT instance_id, location, status, response_time, created_at
        FROM response_times 
        WHERE endpoint_id = ? 
        AND datetime(created_at) > datetime('now', '-10 minutes')
        ORDER BY created_at DESC
      `).all(endpoint.id) as any[];

      if (recentResults.length > 0) {
        await this.createAggregatedResult(endpoint, recentResults);
      }
    }
  }

  private async createAggregatedResult(endpoint: Endpoint, results: any[]): Promise<void> {
    // Group by instance to get latest result per instance
    const latestByInstance = new Map<string, any>();

    for (const result of results) {
      const instanceId = result.instance_id || 'local';
      if (!latestByInstance.has(instanceId)) {
        latestByInstance.set(instanceId, result);
      }
    }

    const instanceResults = Array.from(latestByInstance.values());
    const totalLocations = instanceResults.length;
    const successfulLocations = instanceResults.filter(r => r.status === 'UP').length;

    if (totalLocations === 0) return;

    const avgResponseTime = instanceResults.reduce((sum, r) => sum + r.response_time, 0) / totalLocations;
    const minResponseTime = Math.min(...instanceResults.map(r => r.response_time));
    const maxResponseTime = Math.max(...instanceResults.map(r => r.response_time));

    // Determine consensus status
    let consensusStatus: 'UP' | 'DOWN' | 'PARTIAL';
    if (successfulLocations === totalLocations) {
      consensusStatus = 'UP';
    } else if (successfulLocations === 0) {
      consensusStatus = 'DOWN';
    } else {
      consensusStatus = 'PARTIAL';
    }

    // Create location results object
    const locationResults: Record<string, any> = {};
    for (const result of instanceResults) {
      locationResults[result.instance_id || 'local'] = {
        status: result.status,
        responseTime: result.response_time,
        location: result.location || 'local',
        timestamp: result.created_at
      };
    }

    // Store aggregated result
    this.db.run(`
      INSERT INTO aggregated_results (
        endpoint_id, total_locations, successful_locations,
        avg_response_time, min_response_time, max_response_time,
        consensus_status, location_results
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      endpoint.id,
      totalLocations,
      successfulLocations,
      avgResponseTime,
      minResponseTime,
      maxResponseTime,
      consensusStatus,
      JSON.stringify(locationResults)
    ]);

    this.logger.debug(`Created aggregated result for endpoint ${endpoint.id}: ${consensusStatus} (${successfulLocations}/${totalLocations} locations)`, 'DISTRIBUTED_MONITORING');
  }

  private async cleanupOldMonitoringResults(): Promise<void> {
    try {
      // Delete monitoring results older than 7 days to prevent database bloat
      const result = this.db.run(`
        DELETE FROM monitoring_results
        WHERE timestamp < datetime('now', '-7 days')
      `);

      if (result.changes > 0) {
        this.logger.debug(`Cleaned up ${result.changes} old monitoring results`, 'DISTRIBUTED_MONITORING');
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup old monitoring results: ${error}`, 'DISTRIBUTED_MONITORING');
    }
  }

  private startInstanceHealthMonitoring(): void {
    // Monitor health of dependent instances every 2 minutes
    setInterval(async () => {
      try {
        await this.checkInstanceHealth();
      } catch (error) {
        this.logger.error(`Instance health monitoring error: ${error}`, 'DISTRIBUTED_MONITORING');
      }
    }, 2 * 60 * 1000); // 2 minutes

    this.logger.info('Started instance health monitoring', 'DISTRIBUTED_MONITORING');
  }

  private async checkInstanceHealth(): Promise<void> {
    // Get all instances that haven't sent heartbeat recently
    const staleInstances = this.db.query(`
      SELECT instance_id, instance_name, last_heartbeat
      FROM monitoring_instances 
      WHERE status = 'active'
      AND datetime(last_heartbeat) < datetime('now', '-5 minutes')
    `).all() as any[];

    for (const instance of staleInstances) {
      this.logger.warn(`Instance ${instance.instance_name} (${instance.instance_id}) appears unhealthy - last heartbeat: ${instance.last_heartbeat}`, 'DISTRIBUTED_MONITORING');
      
      // Mark as inactive
      this.db.run(`
        UPDATE monitoring_instances 
        SET status = 'inactive', updated_at = CURRENT_TIMESTAMP 
        WHERE instance_id = ?
      `, [instance.instance_id]);
    }
  }

  getPendingResults(): MonitoringResult[] {
    const results = [...this.pendingResults];
    this.pendingResults = []; // Clear pending results
    return results;
  }

  async switchRole(newRole: 'primary' | 'dependent' | 'standalone', primaryURL?: string): Promise<void> {
    this.logger.info(`Switching from ${this.configService.getInstanceRole()} to ${newRole}`, 'DISTRIBUTED_MONITORING');

    // Stop current operations
    await this.stopCurrentOperations();

    // Update configuration
    switch (newRole) {
      case 'primary':
        await this.configService.promoteToPrimary();
        break;
      case 'dependent':
        if (!primaryURL) {
          throw new Error('Primary URL required for dependent mode');
        }
        await this.configService.demoteToDependent(primaryURL);
        break;
      case 'standalone':
        await this.configService.resetToStandalone();
        break;
    }

    // Reinitialize with new role
    await this.initializeMonitoring();
  }

  private async stopCurrentOperations(): Promise<void> {
    // Stop all monitoring
    const endpoints: Endpoint[] = this.db.query('SELECT * FROM endpoints').all() as Endpoint[];
    for (const endpoint of endpoints) {
      this.stopEndpointMonitoring(endpoint.id);
    }

    // Stop sync operations
    if (this.configService.isDependent()) {
      await this.syncService.stopDependentMode();
      this.failoverManager.stopFailoverMonitoring();
    }
    // Primary instances don't need to stop sync API since it's integrated with main application

    this.logger.info('Stopped current monitoring operations', 'DISTRIBUTED_MONITORING');
  }

  async getDistributedStatus(): Promise<{
    role: string;
    instanceId: string;
    instanceName: string;
    location: string;
    syncedEndpoints: number;
    localEndpoints: number;
    lastSyncTime?: Date;
    pendingResults: number;
  }> {
    return {
      role: this.configService.getInstanceRole(),
      instanceId: this.configService.getInstanceId(),
      instanceName: this.configService.getInstanceName(),
      location: this.configService.getInstanceLocation(),
      syncedEndpoints: this.syncedEndpoints.size,
      localEndpoints: this.localEndpoints.size,
      lastSyncTime: this.lastSyncTime,
      pendingResults: this.pendingResults.length
    };
  }

  // Delegate methods to the wrapped monitoring service
  startEndpointMonitoring(endpoint: Endpoint): void {
    this.monitoringService.startEndpointMonitoring(endpoint);
  }

  stopEndpointMonitoring(endpointId: number): void {
    this.monitoringService.stopEndpointMonitoring(endpointId);
  }

  restartEndpointMonitoring(endpointId: number): void {
    this.monitoringService.restartEndpointMonitoring(endpointId);
  }

  startCertificateMonitoring(endpoint: Endpoint): void {
    this.monitoringService.startCertificateMonitoring(endpoint);
  }

  stopCertificateMonitoring(endpointId: number): void {
    this.monitoringService.stopCertificateMonitoring(endpointId);
  }

  // Endpoint management methods for distributed scenarios
  async addEndpoint(endpoint: Endpoint): Promise<void> {
    // If we're a dependent instance, we shouldn't add endpoints directly
    if (this.configService.isDependent()) {
      throw new Error('Cannot add endpoints on dependent instance. Add to primary instance.');
    }

    // Add to local storage
    this.localEndpoints.set(endpoint.id, endpoint);
    
    // Start monitoring if not paused
    if (!endpoint.paused) {
      this.startEndpointMonitoring(endpoint);
      this.startCertificateMonitoring(endpoint);
    }
  }

  async updateEndpoint(endpoint: Endpoint): Promise<void> {
    // If we're a dependent instance, we shouldn't update endpoints directly
    if (this.configService.isDependent()) {
      throw new Error('Cannot update endpoints on dependent instance. Update on primary instance.');
    }

    // Update local storage
    this.localEndpoints.set(endpoint.id, endpoint);
    
    // Restart monitoring with new configuration
    this.restartEndpointMonitoring(endpoint.id);
  }

  async removeEndpoint(endpointId: number): Promise<void> {
    // If we're a dependent instance, we shouldn't remove endpoints directly
    if (this.configService.isDependent()) {
      throw new Error('Cannot remove endpoints on dependent instance. Remove from primary instance.');
    }

    // Remove from local storage
    this.localEndpoints.delete(endpointId);
    this.syncedEndpoints.delete(endpointId);
    
    // Stop monitoring
    this.stopEndpointMonitoring(endpointId);
  }
}