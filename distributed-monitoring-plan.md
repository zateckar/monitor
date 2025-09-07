# Distributed Monitoring Implementation Plan

## Overview

Transform the existing endpoint monitoring application to support distributed monitoring with primary/dependent instance architecture. The same application will operate in different roles based on configuration.

## Architecture Design

### Instance Roles

```typescript
interface InstanceConfig {
  // Primary Instance Settings
  enableSyncAPI?: boolean;          // If true, becomes PRIMARY
  syncAPIPort?: number;             // Port for sync API (default: 3002)
  
  // Dependent Instance Settings  
  primarySyncURL?: string;          // If set, becomes DEPENDENT
  instanceName: string;             // Unique identifier for this instance
  instanceLocation?: string;        // Geographic location (optional)
  failoverOrder?: number;           // Order for failover promotion
  
  // Connection Settings
  syncInterval?: number;            // How often to sync with primary (seconds)
  heartbeatInterval?: number;       // How often to send heartbeats (seconds)
  connectionTimeout?: number;       // Timeout for primary connection
}
```

### Role Determination Logic

```
STANDALONE: enableSyncAPI=false, primarySyncURL=null
PRIMARY:    enableSyncAPI=true,  primarySyncURL=null  
DEPENDENT:  enableSyncAPI=false, primarySyncURL="http://..."
```

## Synchronization API Contract

### Authentication
- JWT tokens for instance-to-instance communication
- Shared secret or certificate-based authentication
- Instance registration generates access tokens

### Primary Instance API Endpoints

#### Instance Management
```
POST /sync/api/register
PUT  /sync/api/heartbeat
GET  /sync/api/instances
DELETE /sync/api/instances/:id
```

#### Configuration Synchronization
```
GET /sync/api/endpoints
GET /sync/api/endpoints/:id
GET /sync/api/notification-services
```

#### Failover Management
```
GET /sync/api/failover-order
POST /sync/api/promote
POST /sync/api/demote/:id
```

### Data Structures

```typescript
interface InstanceRegistration {
  instanceId: string;
  instanceName: string;
  location?: string;
  version: string;
  capabilities: string[];
  failoverOrder: number;
  publicEndpoint?: string;
  systemInfo: {
    platform: string;
    arch: string;
    nodeVersion: string;
    memory: number;
    cpu: number;
  };
}

interface HeartbeatPayload {
  instanceId: string;
  timestamp: string;
  status: 'healthy' | 'degraded' | 'failing';
  uptime: number;
  monitoringResults: MonitoringResult[];
  systemMetrics: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    activeEndpoints: number;
  };
  connectionStatus: {
    primaryReachable: boolean;
    lastSyncSuccess: string;
    syncErrors: number;
  };
}

interface MonitoringResult {
  endpointId: number;
  instanceId: string;
  timestamp: string;
  isOk: boolean;
  responseTime: number;
  status: 'UP' | 'DOWN';
  failureReason?: string;
  location: string;
  checkType: 'http' | 'tcp' | 'ping' | 'kafka_producer' | 'kafka_consumer';
  metadata?: {
    httpStatus?: number;
    certificateInfo?: any;
    kafkaMetrics?: any;
  };
}

interface SyncConfiguration {
  endpoints: Endpoint[];
  notificationServices: NotificationService[];
  globalSettings: GlobalSettings;
  lastModified: string;
  configVersion: number;
}
```

## Database Schema Changes

### New Tables

```sql
-- Instance registry and management
CREATE TABLE IF NOT EXISTS monitoring_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT UNIQUE NOT NULL,
  instance_name TEXT NOT NULL,
  location TEXT,
  sync_url TEXT,
  failover_order INTEGER DEFAULT 99,
  last_heartbeat DATETIME,
  status TEXT DEFAULT 'active', -- active, inactive, failed, promoting
  capabilities TEXT, -- JSON array of supported features
  system_info TEXT, -- JSON object with system information
  connection_info TEXT, -- JSON object with connection details
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced response times for multi-location tracking
ALTER TABLE response_times ADD COLUMN instance_id TEXT DEFAULT 'local';
ALTER TABLE response_times ADD COLUMN location TEXT DEFAULT 'local';
ALTER TABLE response_times ADD COLUMN check_metadata TEXT; -- JSON for additional check data

-- Instance-specific configuration
CREATE TABLE IF NOT EXISTS instance_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Endpoint synchronization tracking
CREATE TABLE IF NOT EXISTS endpoint_sync_status (
  endpoint_id INTEGER,
  instance_id TEXT,
  last_synced DATETIME,
  config_hash TEXT,
  sync_version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending', -- pending, synced, error
  error_message TEXT,
  PRIMARY KEY (endpoint_id, instance_id),
  FOREIGN KEY(endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
);

-- Aggregated monitoring results
CREATE TABLE IF NOT EXISTS aggregated_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id INTEGER,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_locations INTEGER,
  successful_locations INTEGER,
  avg_response_time REAL,
  min_response_time INTEGER,
  max_response_time INTEGER,
  consensus_status TEXT, -- UP, DOWN, PARTIAL
  location_results TEXT, -- JSON object with per-location results
  FOREIGN KEY(endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
);

-- Instance authentication tokens
CREATE TABLE IF NOT EXISTS instance_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT UNIQUE NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used DATETIME,
  permissions TEXT, -- JSON array of permissions
  FOREIGN KEY(instance_id) REFERENCES monitoring_instances(instance_id) ON DELETE CASCADE
);
```

## Implementation Components

### 1. Configuration Service

```typescript
// backend/src/services/configuration.ts
export class ConfigurationService {
  private config: InstanceConfig;
  private db: Database;
  
  constructor(db: Database) {
    this.db = db;
    this.loadConfiguration();
  }
  
  getInstanceRole(): 'primary' | 'dependent' | 'standalone' {
    if (this.config.enableSyncAPI) return 'primary';
    if (this.config.primarySyncURL) return 'dependent';
    return 'standalone';
  }
  
  isPrimary(): boolean { return this.getInstanceRole() === 'primary'; }
  isDependent(): boolean { return this.getInstanceRole() === 'dependent'; }
  isStandalone(): boolean { return this.getInstanceRole() === 'standalone'; }
  
  async updateRole(newConfig: Partial<InstanceConfig>): Promise<void> {
    // Update configuration and restart services as needed
  }
  
  getInstanceId(): string {
    // Generate or retrieve unique instance identifier
  }
}
```

### 2. Synchronization Service

```typescript
// backend/src/services/synchronization.ts
export class SynchronizationService {
  private config: ConfigurationService;
  private db: Database;
  private logger: LoggerService;
  
  // Primary Instance Methods
  async registerInstance(registration: InstanceRegistration): Promise<string> {
    // Register new dependent instance
    // Generate authentication token
    // Store in monitoring_instances table
    // Return access token
  }
  
  async processHeartbeat(heartbeat: HeartbeatPayload): Promise<void> {
    // Update instance status
    // Store monitoring results
    // Update aggregated results
    // Trigger notifications if needed
  }
  
  async getEndpointsForSync(): Promise<SyncConfiguration> {
    // Return current endpoint configurations
    // Include notification services
    // Add configuration version for change detection
  }
  
  // Dependent Instance Methods
  async registerWithPrimary(): Promise<void> {
    // Register this instance with primary
    // Store authentication token
    // Handle registration failures
  }
  
  async sendHeartbeat(results: MonitoringResult[]): Promise<void> {
    // Send monitoring results to primary
    // Include system metrics
    // Handle connection failures
  }
  
  async fetchEndpointsFromPrimary(): Promise<Endpoint[]> {
    // Get latest endpoint configurations
    // Check for configuration changes
    // Update local cache
  }
  
  // Failover Methods
  async handlePrimaryFailure(): Promise<void> {
    // Detect primary is unreachable
    // Check if this instance should promote
    // Coordinate with other dependents
  }
  
  async promoteToPrimary(): Promise<void> {
    // Enable sync API
    // Import existing monitoring data
    // Notify other instances
    // Start aggregation services
  }
}
```

### 3. Enhanced Monitoring Service

```typescript
// backend/src/services/distributed-monitoring.ts
export class DistributedMonitoringService extends MonitoringService {
  private configService: ConfigurationService;
  private syncService: SynchronizationService;
  
  async initializeMonitoring(): Promise<void> {
    const role = this.configService.getInstanceRole();
    
    switch (role) {
      case 'primary':
        await this.initializePrimaryMode();
        break;
      case 'dependent':
        await this.initializeDependentMode();
        break;
      case 'standalone':
        await super.initializeMonitoring();
        break;
    }
  }
  
  private async initializePrimaryMode(): Promise<void> {
    // Start local monitoring
    await super.initializeMonitoring();
    
    // Start sync API server
    await this.syncService.startSyncAPI();
    
    // Start aggregation service
    await this.startAggregationService();
  }
  
  private async initializeDependentMode(): Promise<void> {
    // Register with primary
    await this.syncService.registerWithPrimary();
    
    // Fetch endpoints from primary
    const endpoints = await this.syncService.fetchEndpointsFromPrimary();
    
    // Start monitoring fetched endpoints
    await this.startMonitoringEndpoints(endpoints);
    
    // Start heartbeat reporting
    this.startHeartbeatReporting();
  }
  
  private async startAggregationService(): Promise<void> {
    // Periodically aggregate results from all instances
    // Calculate consensus status (majority rules)
    // Update aggregated_results table
    // Trigger notifications based on aggregated data
  }
}
```

### 4. Failover Manager

```typescript
// backend/src/services/failover.ts
export class FailoverManager {
  private config: ConfigurationService;
  private sync: SynchronizationService;
  private logger: LoggerService;
  
  async startFailoverMonitoring(): Promise<void> {
    // Only run on dependent instances
    if (!this.config.isDependent()) return;
    
    setInterval(async () => {
      await this.checkPrimaryHealth();
    }, 30000); // Check every 30 seconds
  }
  
  private async checkPrimaryHealth(): Promise<void> {
    const isReachable = await this.sync.isPrimaryReachable();
    
    if (!isReachable) {
      this.failureCount++;
      
      if (this.failureCount >= this.maxFailures) {
        await this.handlePrimaryFailure();
      }
    } else {
      this.failureCount = 0;
    }
  }
  
  private async handlePrimaryFailure(): Promise<void> {
    const shouldPromote = await this.shouldPromoteToPrimary();
    
    if (shouldPromote) {
      await this.promoteToPrimary();
    } else {
      await this.waitForNewPrimary();
    }
  }
  
  private async shouldPromoteToPrimary(): Promise<boolean> {
    // Check failover order
    // Ensure no other instance is promoting
    // Verify this instance is capable
    return true; // Simplified logic
  }
}
```

## Frontend Enhancements

### Multi-Location Dashboard

```typescript
// frontend/src/components/DistributedEndpointList.tsx
interface EndpointWithLocations extends Endpoint {
  locationData: {
    [instanceId: string]: {
      location: string;
      status: 'UP' | 'DOWN';
      responseTime: number;
      lastChecked: string;
      instanceName: string;
    };
  };
  aggregatedStatus: 'UP' | 'DOWN' | 'PARTIAL';
  aggregatedUptime: number;
  consensus: {
    totalLocations: number;
    successfulLocations: number;
    averageResponseTime: number;
  };
}
```

### Instance Management UI

```typescript
// frontend/src/components/InstanceManager.tsx
export function InstanceManager() {
  // Display registered instances
  // Show instance health and status
  // Manage failover order
  // Configure instance roles
}

// frontend/src/components/LocationMap.tsx
export function LocationMap() {
  // Geographic visualization of instances
  // Show monitoring coverage
  // Display performance by region
}
```

## Configuration Examples

### Primary Instance (docker-compose.yml)
```yaml
version: '3.8'
services:
  monitor-primary:
    image: monitor:latest
    environment:
      - ENABLE_SYNC_API=true
      - SYNC_API_PORT=3002
      - INSTANCE_NAME=Primary-US-East
      - INSTANCE_LOCATION=US-East-1
      - DATABASE_PATH=/data/monitor.db
    ports:
      - "3001:3001"  # Main app
      - "3002:3002"  # Sync API
    volumes:
      - monitor_data:/data
```

### Dependent Instance (docker-compose.yml)
```yaml
version: '3.8'
services:
  monitor-dependent:
    image: monitor:latest
    environment:
      - PRIMARY_SYNC_URL=https://primary.monitor.com:3002
      - INSTANCE_NAME=Dependent-EU-West
      - INSTANCE_LOCATION=EU-West-1
      - FAILOVER_ORDER=2
      - SYNC_INTERVAL=30
      - HEARTBEAT_INTERVAL=60
    ports:
      - "3001:3001"  # Main app (for local access)
```

## Implementation Timeline

### Phase 1: Core Infrastructure (Week 1-2)
- Database schema modifications
- Configuration service implementation
- Basic synchronization service structure

### Phase 2: Primary Instance Features (Week 3-4)
- Sync API implementation
- Instance registration and management
- Heartbeat processing

### Phase 3: Dependent Instance Features (Week 5-6)
- Dependent mode monitoring
- Endpoint synchronization
- Heartbeat reporting

### Phase 4: Aggregation and Failover (Week 7-8)
- Result aggregation logic
- Failover detection and promotion
- High availability features

### Phase 5: Frontend Integration (Week 9-10)
- Multi-location dashboard
- Instance management UI
- Configuration interfaces

### Phase 6: Testing and Documentation (Week 11-12)
- Comprehensive testing
- Deployment guides
- Performance optimization

## Benefits

1. **Geographic Monitoring**: Monitor endpoints from multiple locations
2. **High Availability**: Automatic failover prevents single points of failure
3. **Unified Application**: Same codebase for all instances
4. **Independent Operation**: Dependents work during disconnection
5. **Scalable Architecture**: Easy to add new monitoring locations
6. **Backward Compatibility**: Existing deployments continue working

This implementation provides a robust, distributed monitoring solution while maintaining the existing application's simplicity and functionality.