import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SynchronizationService } from '../services/synchronization';
import { DistributedMonitoringService } from '../services/distributed-monitoring';
import { ConfigurationService } from '../services/configuration';
import { LoggerService } from '../services/logger';
import { MonitoringService } from '../services/monitoring';
import { KafkaService } from '../services/kafka';
import { DomainInfoService } from '../services/domain-info';
import { CertificateService } from '../services/certificate';
import type { InstanceRegistration, HeartbeatPayload, MonitoringResult, SystemInfo, Endpoint } from '../types';

// Mock services for integration testing
class MockKafkaService {
  async testConnection() { return { success: true }; }
}

class MockDomainInfoService {
  async getDomainInfo() { return null; }
}

class MockCertificateService {
  async checkCertificate() { return null; }
}

class MockLoggerService {
  info(message: string, category?: string) { console.log(`[${category || 'INFO'}] ${message}`); }
  warn(message: string, category?: string) { console.log(`[${category || 'WARN'}] ${message}`); }
  error(message: string, category?: string) { console.log(`[${category || 'ERROR'}] ${message}`); }
  debug(message: string, category?: string) { console.log(`[${category || 'DEBUG'}] ${message}`); }
}

class MockConfigurationService {
  private role: 'primary' | 'dependent' | 'standalone' = 'primary';
  
  constructor(private db: Database) {}
  
  getInstanceId() { return 'test-primary-1'; }
  getInstanceName() { return 'Test Primary Instance'; }
  getInstanceLocation() { return 'US-East'; }
  getInstanceRole() { return this.role; }
  getPrimarySyncURL() { return 'http://primary:3001'; }
  getFailoverOrder() { return 1; }
  getHeartbeatInterval() { return 10; }
  getSyncInterval() { return 30; }
  getSystemInfo(): SystemInfo { 
    return { 
      platform: 'linux', 
      arch: 'x64', 
      nodeVersion: '20.0.0',
      cpu: 4,
      uptime: 3600, 
      memory: 8589934592 
    }; 
  }
  async getSystemMetrics() { 
    return { 
      cpuUsage: 25.5,
      memoryUsage: 60.2,
      diskUsage: 45.0,
      activeEndpoints: 10
    }; 
  }
  isDependent() { return this.role === 'dependent'; }
  isPrimary() { return this.role === 'primary'; }
  
  setRole(role: 'primary' | 'dependent' | 'standalone') {
    this.role = role;
  }
}

// Helper to create test database with full schema
const createTestDatabase = () => {
  const db = new Database(':memory:');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitoring_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT UNIQUE NOT NULL,
      instance_name TEXT NOT NULL,
      location TEXT,
      sync_url TEXT,
      failover_order INTEGER DEFAULT 99,
      last_heartbeat DATETIME,
      status TEXT DEFAULT 'active',
      capabilities TEXT,
      system_info TEXT,
      connection_info TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS instance_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS instance_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT UNIQUE NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME,
      permissions TEXT,
      FOREIGN KEY(instance_id) REFERENCES monitoring_instances(instance_id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS aggregated_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER NOT NULL,
      total_locations INTEGER NOT NULL,
      successful_locations INTEGER NOT NULL,
      avg_response_time REAL,
      min_response_time REAL,
      max_response_time REAL,
      consensus_status TEXT NOT NULL,
      location_results TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS monitoring_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER NOT NULL,
      instance_id TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_ok BOOLEAN NOT NULL,
      response_time INTEGER,
      status TEXT NOT NULL,
      failure_reason TEXT,
      location TEXT,
      check_type TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS response_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER NOT NULL,
      response_time REAL NOT NULL,
      status TEXT NOT NULL,
      failure_reason TEXT,
      instance_id TEXT,
      location TEXT,
      check_metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      heartbeat_interval INTEGER DEFAULT 30,
      retries INTEGER DEFAULT 3,
      paused BOOLEAN DEFAULT FALSE,
      status TEXT DEFAULT 'UP',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS notification_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled BOOLEAN DEFAULT TRUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS endpoint_sync_status (
      endpoint_id INTEGER NOT NULL,
      instance_id TEXT NOT NULL,
      last_synced DATETIME NOT NULL,
      config_hash TEXT,
      status TEXT DEFAULT 'synced',
      PRIMARY KEY (endpoint_id, instance_id)
    );
  `);
  
  return db;
};

describe('Distributed Monitoring Integration Tests', () => {
  let db: Database;
  let logger: MockLoggerService;
  let configService: MockConfigurationService;
  let syncService: SynchronizationService;
  let distributedService: DistributedMonitoringService;
  let kafkaService: MockKafkaService;
  let domainService: MockDomainInfoService;
  let certService: MockCertificateService;

  beforeEach(() => {
    db = createTestDatabase();
    logger = new MockLoggerService();
    configService = new MockConfigurationService(db);
    syncService = new SynchronizationService(db, configService as any, logger as any);
    kafkaService = new MockKafkaService();
    domainService = new MockDomainInfoService();
    certService = new MockCertificateService();
    
    distributedService = new DistributedMonitoringService(
      db,
      logger as any,
      kafkaService as any,
      domainService as any,
      certService as any,
      async () => {}, // sendNotification mock
      configService as any,
      syncService,
      {} as any // failoverManager mock
    );
  });

  afterEach(() => {
    db.close();
  });

  describe('Full Primary-Dependent Workflow', () => {
    test('should complete full registration and sync workflow', async () => {
      // 1. Setup Primary Instance
      configService.setRole('primary');
      
      // Add test endpoint to primary
      const endpointId = db.run(`
        INSERT INTO endpoints (name, url, type, heartbeat_interval)
        VALUES (?, ?, ?, ?)
      `, ['Test Website', 'https://example.com', 'http', 30]).lastInsertRowid as number;

      // 2. Register Dependent Instance
      const dependentRegistration: InstanceRegistration = {
        instanceId: 'dependent-us-west-1',
        instanceName: 'US West Monitor',
        location: 'US-West',
        version: '1.0.0',
        capabilities: ['http', 'ping'],
        failoverOrder: 1,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          nodeVersion: '20.0.0',
          cpu: 8,
          uptime: 7200,
          memory: 16777216000
        }
      };

      const authToken = await syncService.registerInstance(dependentRegistration);
      expect(typeof authToken).toBe('string');
      expect(authToken.length).toBeGreaterThan(0);

      // Verify instance was registered
      const registeredInstance = db.query(
        'SELECT * FROM monitoring_instances WHERE instance_id = ?'
      ).get('dependent-us-west-1') as any;
      
      expect(registeredInstance).toBeDefined();
      expect(registeredInstance.instance_name).toBe('US West Monitor');
      expect(registeredInstance.location).toBe('US-West');
      expect(registeredInstance.status).toBe('active');

      // 3. Dependent sends heartbeat with monitoring results
      const monitoringResults: MonitoringResult[] = [
        {
          endpointId: endpointId,
          instanceId: 'dependent-us-west-1',
          timestamp: new Date().toISOString(),
          isOk: true,
          responseTime: 145,
          status: 'UP',
          location: 'US-West',
          checkType: 'http',
          metadata: {
            httpStatus: 200
          }
        }
      ];

      const heartbeat: HeartbeatPayload = {
        instanceId: 'dependent-us-west-1',
        timestamp: new Date().toISOString(),
        status: 'healthy',
        uptime: 7200,
        monitoringResults,
        systemMetrics: {
          cpuUsage: 15.5,
          memoryUsage: 45.0,
          diskUsage: 30.0,
          activeEndpoints: 1
        },
        connectionStatus: {
          primaryReachable: true,
          lastSyncSuccess: new Date().toISOString(),
          syncErrors: 0
        }
      };

      await syncService.processHeartbeat(heartbeat);

      // 4. Verify heartbeat was processed
      const updatedInstance = db.query(
        'SELECT * FROM monitoring_instances WHERE instance_id = ?'
      ).get('dependent-us-west-1') as any;
      
      expect(updatedInstance.last_heartbeat).toBeDefined();
      expect(updatedInstance.status).toBe('active');
      
      const systemInfo = JSON.parse(updatedInstance.system_info);
      expect(systemInfo.cpuUsage).toBe(15.5);

      // 5. Verify monitoring result was stored
      const storedResult = db.query(
        'SELECT * FROM monitoring_results WHERE endpoint_id = ? AND instance_id = ?'
      ).get(endpointId, 'dependent-us-west-1') as any;
      
      expect(storedResult).toBeDefined();
      expect(storedResult.status).toBe('UP');
      expect(storedResult.response_time).toBe(145);
      expect(storedResult.location).toBe('US-West');

      // 6. Verify aggregated result was created
      const aggregatedResult = db.query(
        'SELECT * FROM aggregated_results WHERE endpoint_id = ?'
      ).get(endpointId) as any;
      
      expect(aggregatedResult).toBeDefined();
      expect(aggregatedResult.consensus_status).toBe('UP');
      expect(aggregatedResult.total_locations).toBe(1);
      expect(aggregatedResult.successful_locations).toBe(1);
    });

    test('should handle multiple dependent instances with consensus logic', async () => {
      // Setup
      const endpointId = db.run(`
        INSERT INTO endpoints (name, url, type, heartbeat_interval)
        VALUES (?, ?, ?, ?)
      `, ['Test API', 'https://api.example.com', 'http', 60]).lastInsertRowid as number;

      // Register multiple dependent instances
      const instances = [
        {
          instanceId: 'dep-us-east-1',
          instanceName: 'US East Monitor',
          location: 'US-East'
        },
        {
          instanceId: 'dep-eu-west-1',
          instanceName: 'EU West Monitor',
          location: 'EU-West'
        },
        {
          instanceId: 'dep-asia-1',
          instanceName: 'Asia Monitor',
          location: 'Asia-Pacific'
        }
      ];

      for (const instance of instances) {
        await syncService.registerInstance({
          instanceId: instance.instanceId,
          instanceName: instance.instanceName,
          location: instance.location,
          version: '1.0.0',
          capabilities: ['http'],
          failoverOrder: 1,
          systemInfo: {
            platform: 'linux',
            arch: 'x64',
            nodeVersion: '20.0.0',
            cpu: 4,
            uptime: 3600,
            memory: 8589934592
          }
        });
      }

      // Send different results from each location (partial outage scenario)
      const results = [
        {
          instanceId: 'dep-us-east-1',
          location: 'US-East',
          status: 'UP' as const,
          responseTime: 120
        },
        {
          instanceId: 'dep-eu-west-1',
          location: 'EU-West',
          status: 'UP' as const,
          responseTime: 250
        },
        {
          instanceId: 'dep-asia-1',
          location: 'Asia-Pacific',
          status: 'DOWN' as const,
          responseTime: 0,
          failureReason: 'Connection timeout'
        }
      ];

      for (const result of results) {
        const monitoringResults: MonitoringResult[] = [{
          endpointId: endpointId,
          instanceId: result.instanceId,
          timestamp: new Date().toISOString(),
          isOk: result.status === 'UP',
          responseTime: result.responseTime,
          status: result.status,
          location: result.location,
          checkType: 'http',
          failureReason: result.failureReason
        }];

        const heartbeat: HeartbeatPayload = {
          instanceId: result.instanceId,
          timestamp: new Date().toISOString(),
          status: 'healthy',
          uptime: 3600,
          monitoringResults,
          systemMetrics: {
            cpuUsage: 20.0,
            memoryUsage: 50.0,
            diskUsage: 40.0,
            activeEndpoints: 1
          },
          connectionStatus: {
            primaryReachable: true,
            lastSyncSuccess: new Date().toISOString(),
            syncErrors: 0
          }
        };

        await syncService.processHeartbeat(heartbeat);
      }

      // Verify consensus result
      const aggregatedResult = db.query(
        'SELECT * FROM aggregated_results WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(endpointId) as any;
      
      expect(aggregatedResult).toBeDefined();
      expect(aggregatedResult.consensus_status).toBe('PARTIAL'); // 2/3 UP = PARTIAL
      expect(aggregatedResult.total_locations).toBe(3);
      expect(aggregatedResult.successful_locations).toBe(2);
      expect(aggregatedResult.avg_response_time).toBe(123.33333333333333);

      // Verify individual results were stored
      const individualResults = db.query(
        'SELECT * FROM monitoring_results WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT 3'
      ).all(endpointId) as any[];
      
      expect(individualResults).toHaveLength(3);
      
      const usEastResult = individualResults.find(r => r.location === 'US-East');
      const euWestResult = individualResults.find(r => r.location === 'EU-West');
      const asiaResult = individualResults.find(r => r.location === 'Asia-Pacific');
      
      expect(usEastResult.status).toBe('UP');
      expect(euWestResult.status).toBe('UP');
      expect(asiaResult.status).toBe('DOWN');
      expect(asiaResult.failure_reason).toBe('Connection timeout');
    });

    test('should handle failover scenario', async () => {
      // Register multiple instances with different failover orders
      const instances = [
        {
          instanceId: 'primary-1',
          instanceName: 'Primary Instance',
          location: 'US-East',
          failoverOrder: 0 // Primary
        },
        {
          instanceId: 'backup-1',
          instanceName: 'Backup Instance 1',
          location: 'US-West',
          failoverOrder: 1
        },
        {
          instanceId: 'backup-2',
          instanceName: 'Backup Instance 2',
          location: 'EU-West',
          failoverOrder: 2
        }
      ];

      for (const instance of instances) {
        await syncService.registerInstance({
          instanceId: instance.instanceId,
          instanceName: instance.instanceName,
          location: instance.location,
          version: '1.0.0',
          capabilities: ['http'],
          failoverOrder: instance.failoverOrder,
          systemInfo: {
            platform: 'linux',
            arch: 'x64',
            nodeVersion: '20.0.0',
            cpu: 4,
            uptime: 3600,
            memory: 8589934592
          }
        });
      }

      // Verify failover order
      const orderedInstances = await syncService.getFailoverOrder();
      expect(orderedInstances).toHaveLength(3);
      if (orderedInstances.length >= 3 && orderedInstances[0] && orderedInstances[1] && orderedInstances[2]) {
        expect(orderedInstances[0].instanceId).toBe('primary-1');
        expect(orderedInstances[1].instanceId).toBe('backup-1');
        expect(orderedInstances[2].instanceId).toBe('backup-2');
      }

      // Simulate primary failure
      db.run(
        'UPDATE monitoring_instances SET status = ?, last_heartbeat = datetime("now", "-10 minutes") WHERE instance_id = ?',
        ['failed', 'primary-1']
      );

      // Get next in line for promotion
      const activeInstances = db.query(
        'SELECT * FROM monitoring_instances WHERE status = "active" ORDER BY failover_order LIMIT 1'
      ).get() as any;
      
      expect(activeInstances.instance_id).toBe('backup-1');
    });
  });

  describe('Configuration Synchronization', () => {
    test('should sync endpoint configuration between instances', async () => {
      // Setup primary with endpoints
      const endpoints = [
        { name: 'Website', url: 'https://example.com', type: 'http' },
        { name: 'API', url: 'https://api.example.com', type: 'http' },
        { name: 'Database', url: 'db.example.com', type: 'tcp' }
      ];

      for (const endpoint of endpoints) {
        db.run(`
          INSERT INTO endpoints (name, url, type, heartbeat_interval)
          VALUES (?, ?, ?, ?)
        `, [endpoint.name, endpoint.url, endpoint.type, 30]);
      }

      // Add notification service
      db.run(`
        INSERT INTO notification_services (name, type, config, enabled)
        VALUES (?, ?, ?, ?)
      `, ['Telegram Bot', 'telegram', '{"token":"test-token","chatId":"123"}', true]);

      const syncConfig = await syncService.getEndpointsForSync();
      
      expect(syncConfig).toHaveLength(3);

      // Verify specific endpoint data
      const websiteEndpoint = syncConfig.find(e => e.name === 'Website');
      expect(websiteEndpoint).toBeDefined();
      expect(websiteEndpoint?.url).toBe('https://example.com');
      expect(websiteEndpoint?.type).toBe('http');
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle stale instance cleanup', async () => {
      // Register instances with different heartbeat times
      const instances = [
        {
          instanceId: 'healthy-1',
          instanceName: 'Healthy Instance',
          heartbeatOffset: 0 // Current time
        },
        {
          instanceId: 'stale-1',
          instanceName: 'Stale Instance',
          heartbeatOffset: -600 // 10 minutes ago
        },
        {
          instanceId: 'failed-1',
          instanceName: 'Failed Instance',
          heartbeatOffset: -1800 // 30 minutes ago
        }
      ];

      for (const instance of instances) {
        await syncService.registerInstance({
          instanceId: instance.instanceId,
          instanceName: instance.instanceName,
          location: 'US-East',
          version: '1.0.0',
          capabilities: ['http'],
          failoverOrder: 1,
          systemInfo: {
            platform: 'linux',
            arch: 'x64',
            nodeVersion: '20.0.0',
            cpu: 4,
            uptime: 3600,
            memory: 8589934592
          }
        });

        // Manually set heartbeat time
        const heartbeatTime = new Date(Date.now() + (instance.heartbeatOffset * 1000)).toISOString();
        db.run(
          'UPDATE monitoring_instances SET last_heartbeat = ? WHERE instance_id = ?',
          [heartbeatTime, instance.instanceId]
        );
      }

      // Query stale instances (older than 5 minutes)
      const staleInstances = db.query(`
        SELECT instance_id, instance_name, last_heartbeat
        FROM monitoring_instances 
        WHERE status = 'active'
        AND datetime(last_heartbeat) < datetime('now', '-5 minutes')
      `).all() as any[];

      expect(staleInstances).toHaveLength(2);
      expect(staleInstances.find(i => i.instance_id === 'stale-1')).toBeDefined();
      expect(staleInstances.find(i => i.instance_id === 'failed-1')).toBeDefined();
      expect(staleInstances.find(i => i.instance_id === 'healthy-1')).toBeUndefined();
    });

    test('should handle invalid heartbeat data gracefully', async () => {
      // Register instance first
      await syncService.registerInstance({
        instanceId: 'test-instance',
        instanceName: 'Test Instance',
        location: 'US-East',
        version: '1.0.0',
        capabilities: ['http'],
        failoverOrder: 1,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          nodeVersion: '20.0.0',
          cpu: 4,
          uptime: 3600,
          memory: 8589934592
        }
      });

      // Send heartbeat with invalid monitoring result
      const invalidHeartbeat: HeartbeatPayload = {
        instanceId: 'test-instance',
        timestamp: new Date().toISOString(),
        status: 'healthy',
        uptime: 3600,
        monitoringResults: [
          {
            endpointId: 999999, // Non-existent endpoint
            instanceId: 'test-instance',
            timestamp: new Date().toISOString(),
            isOk: true,
            responseTime: 100,
            status: 'UP',
            location: 'US-East',
            checkType: 'http'
          }
        ],
        systemMetrics: {
          cpuUsage: 25.0,
          memoryUsage: 60.0,
          diskUsage: 45.0,
          activeEndpoints: 1
        },
        connectionStatus: {
          primaryReachable: true,
          lastSyncSuccess: new Date().toISOString(),
          syncErrors: 0
        }
      };

      // Should not throw error but handle gracefully
      await expect(syncService.processHeartbeat(invalidHeartbeat)).resolves.not.toThrow();

      // Verify instance heartbeat was still updated
      const updatedInstance = db.query(
        'SELECT * FROM monitoring_instances WHERE instance_id = ?'
      ).get('test-instance') as any;
      
      expect(updatedInstance.last_heartbeat).toBeDefined();
      expect(updatedInstance.status).toBe('active');
    });
  });

  describe('Performance Under Load', () => {
    test('should handle many concurrent heartbeats efficiently', async () => {
      const instanceCount = 20;
      const endpointsPerInstance = 5;

      // Setup endpoints
      const endpointIds: number[] = [];
      for (let i = 0; i < endpointsPerInstance; i++) {
        const id = db.run(`
          INSERT INTO endpoints (name, url, type, heartbeat_interval)
          VALUES (?, ?, ?, ?)
        `, [`Endpoint ${i}`, `https://example${i}.com`, 'http', 30]).lastInsertRowid as number;
        endpointIds.push(id);
      }

      // Register instances
      const instances: string[] = [];
      for (let i = 0; i < instanceCount; i++) {
        const instanceId = `load-test-${i}`;
        instances.push(instanceId);
        
        await syncService.registerInstance({
          instanceId,
          instanceName: `Load Test Instance ${i}`,
          location: `Region-${i % 5}`,
          version: '1.0.0',
          capabilities: ['http'],
          failoverOrder: i + 1,
          systemInfo: {
            platform: 'linux',
            arch: 'x64',
            nodeVersion: '20.0.0',
            cpu: 4,
            uptime: 3600,
            memory: 8589934592
          }
        });
      }

      // Send concurrent heartbeats
      const startTime = Date.now();
      
      const heartbeatPromises = instances.map(instanceId => {
        const monitoringResults: MonitoringResult[] = endpointIds.map(endpointId => ({
          endpointId,
          instanceId,
          timestamp: new Date().toISOString(),
          isOk: Math.random() > 0.1, // 90% success rate
          responseTime: Math.random() * 500 + 50,
          status: Math.random() > 0.1 ? 'UP' : 'DOWN',
          location: `Region-${instances.indexOf(instanceId) % 5}`,
          checkType: 'http'
        }));

        const heartbeat: HeartbeatPayload = {
          instanceId,
          timestamp: new Date().toISOString(),
          status: 'healthy',
          uptime: 3600,
          monitoringResults,
          systemMetrics: {
            cpuUsage: Math.random() * 50 + 10,
            memoryUsage: Math.random() * 40 + 30,
            diskUsage: Math.random() * 30 + 20,
            activeEndpoints: endpointsPerInstance
          },
          connectionStatus: {
            primaryReachable: true,
            lastSyncSuccess: new Date().toISOString(),
            syncErrors: 0
          }
        };

        return syncService.processHeartbeat(heartbeat);
      });

      await Promise.all(heartbeatPromises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(10000); // 10 seconds

      // Verify all results were stored
      const totalResults = db.query('SELECT COUNT(*) as count FROM monitoring_results').get() as any;
      expect(totalResults.count).toBe(instanceCount * endpointsPerInstance);

      // Verify aggregated results were created
      const aggregatedCount = db.query('SELECT COUNT(*) as count FROM aggregated_results').get() as any;
      expect(aggregatedCount.count).toBeGreaterThan(0);

      console.log(`Performance test: ${instanceCount} instances × ${endpointsPerInstance} endpoints = ${totalResults.count} results in ${duration}ms`);
    });
  });
});