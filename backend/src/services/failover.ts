import { Database } from 'bun:sqlite';
import { ConfigurationService } from './configuration';
import { SynchronizationService } from './synchronization';
import { LoggerService } from './logger';
import type { MonitoringInstance } from '../types';

export class FailoverManager {
  private healthCheckTimer?: NodeJS.Timeout;
  private failureCount = 0;
  private maxFailures = 3;
  private isPromoting = false;
  private lastPrimaryContact?: Date;
  private promotionInProgress = false;

  constructor(
    private db: Database,
    private config: ConfigurationService,
    private sync: SynchronizationService,
    private logger: LoggerService
  ) {}

  async startFailoverMonitoring(): Promise<void> {
    // Only start on dependent instances
    if (!this.config.isDependent()) {
      this.logger.debug('Failover monitoring not started - not a dependent instance', 'FAILOVER');
      return;
    }

    // Check primary health every 30 seconds
    this.healthCheckTimer = setInterval(async () => {
      await this.checkPrimaryHealth();
    }, 30000);

    this.logger.info('Started failover monitoring', 'FAILOVER');
  }

  stopFailoverMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      this.logger.info('Stopped failover monitoring', 'FAILOVER');
    }
  }

  private async checkPrimaryHealth(): Promise<void> {
    try {
      const isReachable = await this.sync.isPrimaryReachable();
      
      if (isReachable) {
        // Primary is healthy
        if (this.failureCount > 0) {
          this.logger.info(`Primary connection restored after ${this.failureCount} failures`, 'FAILOVER');
        }
        this.failureCount = 0;
        this.lastPrimaryContact = new Date();
        this.promotionInProgress = false;
      } else {
        // Primary is unreachable
        this.failureCount++;
        this.logger.warn(`Primary unreachable (failure ${this.failureCount}/${this.maxFailures})`, 'FAILOVER');
        
        if (this.failureCount >= this.maxFailures && !this.promotionInProgress) {
          await this.handlePrimaryFailure();
        }
      }
    } catch (error) {
      this.logger.error(`Error during primary health check: ${error}`, 'FAILOVER');
    }
  }

  private async handlePrimaryFailure(): Promise<void> {
    if (this.isPromoting) {
      this.logger.debug('Already promoting, skipping failover handling', 'FAILOVER');
      return;
    }

    this.logger.error(`Primary instance failed after ${this.failureCount} attempts`, 'FAILOVER');
    
    try {
      // Check if this instance should promote
      const shouldPromote = await this.shouldPromoteToPrimary();
      
      if (shouldPromote) {
        await this.promoteToPrimary();
      } else {
        await this.waitForNewPrimary();
      }
    } catch (error) {
      this.logger.error(`Error handling primary failure: ${error}`, 'FAILOVER');
    }
  }

  private async shouldPromoteToPrimary(): Promise<boolean> {
    try {
      // Get our failover order
      const myOrder = this.config.getFailoverOrder();
      const myInstanceId = this.config.getInstanceId();
      
      // Check if there are other instances with better failover order
      const betterInstances = this.db.query(`
        SELECT instance_id, failover_order, last_heartbeat 
        FROM monitoring_instances 
        WHERE failover_order < ? 
        AND status = 'active'
        AND instance_id != ?
        AND datetime(last_heartbeat) > datetime('now', '-5 minutes')
      `).all(myOrder, myInstanceId) as any[];

      if (betterInstances.length > 0) {
        this.logger.info(`Not promoting - ${betterInstances.length} instances with better failover order exist`, 'FAILOVER');
        return false;
      }

      // Check if another instance is already promoting
      const promotingInstances = this.db.query(`
        SELECT instance_id 
        FROM monitoring_instances 
        WHERE status = 'promoting'
        AND instance_id != ?
      `).all(myInstanceId) as any[];

      if (promotingInstances.length > 0) {
        this.logger.info(`Not promoting - another instance is already promoting`, 'FAILOVER');
        return false;
      }

      // Mark ourselves as promoting to prevent other instances from promoting
      this.db.run(`
        UPDATE monitoring_instances 
        SET status = 'promoting', updated_at = CURRENT_TIMESTAMP 
        WHERE instance_id = ?
      `, [myInstanceId]);

      this.promotionInProgress = true;
      
      // Wait a bit to see if another instance with better order comes online
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Double-check that no better instance came online
      const betterInstancesAfterWait = this.db.query(`
        SELECT instance_id, failover_order 
        FROM monitoring_instances 
        WHERE failover_order < ? 
        AND status = 'active'
        AND instance_id != ?
        AND datetime(last_heartbeat) > datetime('now', '-2 minutes')
      `).all(myOrder, myInstanceId) as any[];

      if (betterInstancesAfterWait.length > 0) {
        this.logger.info(`Canceling promotion - better instance came online`, 'FAILOVER');
        // Reset our status
        this.db.run(`
          UPDATE monitoring_instances 
          SET status = 'active', updated_at = CURRENT_TIMESTAMP 
          WHERE instance_id = ?
        `, [myInstanceId]);
        this.promotionInProgress = false;
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Error determining promotion eligibility: ${error}`, 'FAILOVER');
      return false;
    }
  }

  private async promoteToPrimary(): Promise<void> {
    if (this.isPromoting) {
      this.logger.warn('Already promoting to primary', 'FAILOVER');
      return;
    }

    this.isPromoting = true;
    this.logger.info('Starting promotion to primary instance', 'FAILOVER');

    try {
      // 1. Stop dependent mode operations
      this.stopFailoverMonitoring();
      await this.sync.stopDependentMode();

      // 2. Update configuration to primary mode
      await this.config.promoteToPrimary();

      // 3. Start sync API
      // Sync API routes are now integrated with main application, no need to start separately
      this.logger.info('Primary promotion completed - sync API routes now active', 'FAILOVER');

      // 4. Update instance status in database
      const myInstanceId = this.config.getInstanceId();
      this.db.run(`
        UPDATE monitoring_instances 
        SET status = 'active', updated_at = CURRENT_TIMESTAMP 
        WHERE instance_id = ?
      `, [myInstanceId]);

      // 5. Import existing monitoring data from other instances (if any)
      await this.importMonitoringData();

      // 6. Notify other dependent instances about the new primary
      await this.notifyInstancesOfNewPrimary();

      this.logger.info(`Successfully promoted to primary instance`, 'FAILOVER');
      
      // Reset failover state
      this.failureCount = 0;
      this.promotionInProgress = false;
      
    } catch (error) {
      this.logger.error(`Failed to promote to primary: ${error}`, 'FAILOVER');
      this.isPromoting = false;
      this.promotionInProgress = false;
      
      // Reset status on failure
      try {
        const myInstanceId = this.config.getInstanceId();
        this.db.run(`
          UPDATE monitoring_instances 
          SET status = 'active', updated_at = CURRENT_TIMESTAMP 
          WHERE instance_id = ?
        `, [myInstanceId]);
      } catch (resetError) {
        this.logger.error(`Failed to reset instance status: ${resetError}`, 'FAILOVER');
      }
      
      throw error;
    }
  }

  private async waitForNewPrimary(): Promise<void> {
    this.logger.info('Waiting for another instance to become primary', 'FAILOVER');
    
    // Wait up to 2 minutes for a new primary to be established
    const maxWaitTime = 120000; // 2 minutes
    const checkInterval = 10000; // 10 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      // Check if any instance has become primary
      const primaryInstances = this.db.query(`
        SELECT instance_id, instance_name
        FROM monitoring_instances 
        WHERE status = 'active'
        AND datetime(last_heartbeat) > datetime('now', '-2 minutes')
        ORDER BY failover_order
        LIMIT 1
      `).all() as any[];

      if (primaryInstances.length > 0) {
        const newPrimary = primaryInstances[0];
        this.logger.info(`New primary detected: ${newPrimary.instance_name} (${newPrimary.instance_id})`, 'FAILOVER');
        
        // Update our configuration to point to the new primary
        // Note: In a real implementation, we'd need a way to discover the new primary's URL
        // This could be done through service discovery, DNS, or a configuration update mechanism
        
        break;
      }
    }

    // If no primary was found after waiting, consider promoting ourselves
    if (Date.now() - startTime >= maxWaitTime) {
      this.logger.warn('No new primary found after waiting period, reconsidering promotion', 'FAILOVER');
      const shouldPromote = await this.shouldPromoteToPrimary();
      if (shouldPromote) {
        await this.promoteToPrimary();
      }
    }
  }

  private async importMonitoringData(): Promise<void> {
    try {
      // Import recent monitoring data from other instances that might have been collected
      // while we were a dependent instance
      
      // For now, we'll just log this step
      // In a full implementation, this could involve:
      // 1. Querying other dependent instances for their recent data
      // 2. Merging that data into our aggregated results
      // 3. Ensuring no data loss during the transition
      
      this.logger.info('Monitoring data import completed (placeholder)', 'FAILOVER');
    } catch (error) {
      this.logger.warn(`Failed to import monitoring data: ${error}`, 'FAILOVER');
      // Non-critical error, continue with promotion
    }
  }

  private async notifyInstancesOfNewPrimary(): Promise<void> {
    try {
      // Get all active dependent instances
      const dependentInstances = this.db.query(`
        SELECT instance_id, instance_name, sync_url
        FROM monitoring_instances 
        WHERE status = 'active'
        AND instance_id != ?
        AND datetime(last_heartbeat) > datetime('now', '-5 minutes')
      `).all(this.config.getInstanceId()) as any[];

      // In a real implementation, we would need a way to notify these instances
      // This could be done through:
      // 1. A callback URL that dependent instances register
      // 2. A message queue system
      // 3. A discovery service
      // 4. Direct HTTP calls (if we know their endpoints)

      this.logger.info(`Would notify ${dependentInstances.length} dependent instances of new primary`, 'FAILOVER');
      
      // For now, we'll just update the database to reflect that we're the new primary
      // Other instances will discover this through their regular sync attempts failing
      // and then checking the instance registry
      
    } catch (error) {
      this.logger.warn(`Failed to notify instances of new primary: ${error}`, 'FAILOVER');
      // Non-critical error, continue
    }
  }

  async handleInstanceDown(instanceId: string): Promise<void> {
    try {
      // Mark instance as inactive
      this.db.run(`
        UPDATE monitoring_instances 
        SET status = 'inactive', updated_at = CURRENT_TIMESTAMP 
        WHERE instance_id = ?
      `, [instanceId]);

      this.logger.info(`Marked instance ${instanceId} as inactive`, 'FAILOVER');

      // If this was the primary instance and we're a dependent, start failover process
      if (this.config.isDependent()) {
        const primaryURL = this.config.getPrimarySyncURL();
        if (primaryURL && primaryURL.includes(instanceId)) {
          this.logger.warn('Primary instance appears to be down, starting failover process', 'FAILOVER');
          this.failureCount = this.maxFailures; // Trigger immediate failover
          await this.handlePrimaryFailure();
        }
      }
    } catch (error) {
      this.logger.error(`Error handling instance down event: ${error}`, 'FAILOVER');
    }
  }

  async getFailoverStatus(): Promise<{
    role: string;
    failureCount: number;
    isPromoting: boolean;
    lastPrimaryContact?: Date;
    failoverOrder: number;
  }> {
    return {
      role: this.config.getInstanceRole(),
      failureCount: this.failureCount,
      isPromoting: this.isPromoting,
      lastPrimaryContact: this.lastPrimaryContact,
      failoverOrder: this.config.getFailoverOrder()
    };
  }

  async getFailoverCandidates(): Promise<MonitoringInstance[]> {
    // Get all instances that could potentially become primary, ordered by failover order
    return this.db.query(`
      SELECT * FROM monitoring_instances 
      WHERE status IN ('active', 'promoting')
      AND datetime(last_heartbeat) > datetime('now', '-5 minutes')
      ORDER BY failover_order, created_at
    `).all() as MonitoringInstance[];
  }

  async forcePromotion(): Promise<void> {
    this.logger.warn('Forcing promotion to primary (manual override)', 'FAILOVER');
    this.failureCount = this.maxFailures;
    await this.promoteToPrimary();
  }

  async resetFailoverState(): Promise<void> {
    this.failureCount = 0;
    this.isPromoting = false;
    this.promotionInProgress = false;
    this.lastPrimaryContact = new Date();
    
    // Reset instance status in database
    const myInstanceId = this.config.getInstanceId();
    this.db.run(`
      UPDATE monitoring_instances 
      SET status = 'active', updated_at = CURRENT_TIMESTAMP 
      WHERE instance_id = ?
    `, [myInstanceId]);

    this.logger.info('Reset failover state', 'FAILOVER');
  }
}