# Distributed Monitoring Configuration Guide

This guide explains how to configure the endpoint monitoring application for distributed monitoring across multiple instances.

## Environment Variables

### Instance Role Configuration

#### Primary Instance
```bash
# Enable sync API to make this instance the primary
ENABLE_SYNC_API=true

# Port for the synchronization API (default: 3002)
SYNC_API_PORT=3002

# Instance identification
INSTANCE_NAME="Primary-US-East"
INSTANCE_LOCATION="US-East-1"

# Database path (primary instance stores all data)
DATABASE_PATH="/data/monitor.db"
```

#### Dependent Instance
```bash
# URL of the primary instance's sync API
PRIMARY_SYNC_URL="https://primary.monitor.com:3002"

# Instance identification
INSTANCE_NAME="Dependent-EU-West"
INSTANCE_LOCATION="EU-West-1"

# Failover order (lower numbers have higher priority)
FAILOVER_ORDER=2

# Sync configuration
SYNC_INTERVAL=30           # How often to sync with primary (seconds)
HEARTBEAT_INTERVAL=60      # How often to send heartbeats (seconds)
CONNECTION_TIMEOUT=30000   # Connection timeout (milliseconds)

# Local database for caching (dependent instances have their own copy)
DATABASE_PATH="/data/monitor.db"
```

#### Standalone Instance (Default)
```bash
# No special configuration needed - runs independently
INSTANCE_NAME="Standalone-Monitor"
INSTANCE_LOCATION="Local"

DATABASE_PATH="/data/monitor.db"
```

### Complete Environment Variable Reference

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ENABLE_SYNC_API` | boolean | `false` | Enable sync API (makes instance primary) |
| `SYNC_API_PORT` | number | `3002` | Port for synchronization API |
| `PRIMARY_SYNC_URL` | string | - | URL of primary instance (makes instance dependent) |
| `INSTANCE_NAME` | string | `monitor-{hostname}` | Unique name for this instance |
| `INSTANCE_LOCATION` | string | `unknown` | Geographic location identifier |
| `FAILOVER_ORDER` | number | `99` | Priority for automatic promotion (lower = higher priority) |
| `SYNC_INTERVAL` | number | `30` | Endpoint sync interval in seconds |
| `HEARTBEAT_INTERVAL` | number | `60` | Heartbeat reporting interval in seconds |
| `CONNECTION_TIMEOUT` | number | `30000` | Connection timeout in milliseconds |

## Deployment Examples

### Docker Compose - Primary Instance

```yaml
version: '3.8'
services:
  monitor-primary:
    image: endpoint-monitor:latest
    container_name: monitor-primary
    environment:
      # Primary instance configuration
      - ENABLE_SYNC_API=true
      - SYNC_API_PORT=3002
      - INSTANCE_NAME=Primary-US-East
      - INSTANCE_LOCATION=US-East-1
      
      # Database configuration
      - DATABASE_PATH=/data/monitor.db
      
      # Optional: Authentication
      - JWT_SECRET=your-secure-jwt-secret
      
    ports:
      - "3001:3001"  # Main application
      - "3002:3002"  # Sync API
      
    volumes:
      - monitor_data:/data
      - ./config:/app/config
      
    restart: unless-stopped
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/endpoints"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  monitor_data:
    driver: local
```

### Docker Compose - Dependent Instance

```yaml
version: '3.8'
services:
  monitor-dependent:
    image: endpoint-monitor:latest
    container_name: monitor-dependent-eu
    environment:
      # Dependent instance configuration
      - PRIMARY_SYNC_URL=https://primary.monitor.com:3002
      - INSTANCE_NAME=Dependent-EU-West
      - INSTANCE_LOCATION=EU-West-1
      - FAILOVER_ORDER=2
      
      # Sync configuration
      - SYNC_INTERVAL=30
      - HEARTBEAT_INTERVAL=60
      - CONNECTION_TIMEOUT=30000
      
      # Database configuration
      - DATABASE_PATH=/data/monitor.db
      
    ports:
      - "3001:3001"  # Main application (for local access)
      
    volumes:
      - monitor_data_eu:/data
      - ./config:/app/config
      
    restart: unless-stopped
    
    depends_on:
      - monitor-primary  # If deploying together
      
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/instance/status"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  monitor_data_eu:
    driver: local
```

### Kubernetes Deployment - Primary Instance

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: monitor-primary
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: monitor-primary
  template:
    metadata:
      labels:
        app: monitor-primary
    spec:
      containers:
      - name: monitor
        image: endpoint-monitor:latest
        env:
        - name: ENABLE_SYNC_API
          value: "true"
        - name: SYNC_API_PORT
          value: "3002"
        - name: INSTANCE_NAME
          value: "Primary-K8s-Cluster"
        - name: INSTANCE_LOCATION
          value: "US-East-1"
        - name: DATABASE_PATH
          value: "/data/monitor.db"
        ports:
        - containerPort: 3001
          name: http
        - containerPort: 3002
          name: sync-api
        volumeMounts:
        - name: data
          mountPath: /data
        livenessProbe:
          httpGet:
            path: /api/endpoints
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /api/instance/status
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 10
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: monitor-data

---
apiVersion: v1
kind: Service
metadata:
  name: monitor-primary-service
  namespace: monitoring
spec:
  selector:
    app: monitor-primary
  ports:
  - name: http
    port: 3001
    targetPort: 3001
  - name: sync-api
    port: 3002
    targetPort: 3002
  type: LoadBalancer
```

### Kubernetes Deployment - Dependent Instance

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: monitor-dependent-eu
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: monitor-dependent-eu
  template:
    metadata:
      labels:
        app: monitor-dependent-eu
    spec:
      containers:
      - name: monitor
        image: endpoint-monitor:latest
        env:
        - name: PRIMARY_SYNC_URL
          value: "http://monitor-primary-service:3002"
        - name: INSTANCE_NAME
          value: "Dependent-EU-K8s"
        - name: INSTANCE_LOCATION
          value: "EU-West-1"
        - name: FAILOVER_ORDER
          value: "2"
        - name: SYNC_INTERVAL
          value: "30"
        - name: HEARTBEAT_INTERVAL
          value: "60"
        - name: DATABASE_PATH
          value: "/data/monitor.db"
        ports:
        - containerPort: 3001
          name: http
        volumeMounts:
        - name: data
          mountPath: /data
        livenessProbe:
          httpGet:
            path: /api/instance/status
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /api/instance/status
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 10
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: monitor-data-eu

---
apiVersion: v1
kind: Service
metadata:
  name: monitor-dependent-eu-service
  namespace: monitoring
spec:
  selector:
    app: monitor-dependent-eu
  ports:
  - name: http
    port: 3001
    targetPort: 3001
  type: ClusterIP
```

## Configuration Validation

The application automatically validates the configuration on startup. You can also check the configuration via the API:

### Check Instance Configuration
```bash
curl -X GET http://localhost:3001/api/instance/config \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Check Instance Status
```bash
curl -X GET http://localhost:3001/api/instance/status
```

### Switch Instance Role (Admin only)
```bash
curl -X POST http://localhost:3001/api/instance/switch-role \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -d '{
    "role": "dependent",
    "primaryURL": "https://new-primary.monitor.com:3002"
  }'
```

## Failover Configuration

### Automatic Failover
Dependent instances automatically detect primary failure and promote themselves based on `FAILOVER_ORDER`:

1. Instance with lowest `FAILOVER_ORDER` value promotes first
2. If multiple instances have same order, earliest created promotes
3. 5-second coordination window prevents split-brain scenarios
4. Failed primary detection after 3 consecutive connection failures

### Manual Failover
Force promotion of a dependent instance:

```bash
curl -X POST http://localhost:3001/api/instance/force-promotion \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN"
```

### Failover Order Planning
```bash
# Example failover hierarchy
Primary Instance:     FAILOVER_ORDER=0  (or ENABLE_SYNC_API=true)
Dependent Instance 1: FAILOVER_ORDER=1  (first backup)
Dependent Instance 2: FAILOVER_ORDER=2  (second backup)
Dependent Instance 3: FAILOVER_ORDER=3  (third backup)
```

## Security Considerations

### Network Security
- Use HTTPS for `PRIMARY_SYNC_URL` in production
- Restrict sync API port (`3002`) to trusted networks
- Implement firewall rules between instances

### Authentication
- Each instance generates unique JWT secrets
- Primary instance authenticates dependent instances
- Use strong passwords for admin accounts

### Data Security
- Enable database encryption at rest
- Secure backup procedures for primary instance
- Regular security updates for all instances

## Monitoring the Monitoring System

### Health Checks
Each instance provides health check endpoints:
- `/api/instance/status` - Instance health and role
- `/api/instance/failover-status` - Failover state
- `/api/instances` - Connected instances (primary only)

### Metrics to Monitor
- Heartbeat success rate between instances
- Sync API response times
- Database synchronization lag
- Instance connection count
- Failover events

### Alerting
Set up alerts for:
- Primary instance unreachable
- Dependent instance disconnection
- Failover events
- Configuration validation errors
- Database synchronization failures

## Troubleshooting

### Common Issues

#### Dependent Instance Cannot Connect
```bash
# Check connectivity
curl -f http://primary.monitor.com:3002/sync/api/instances

# Check logs
docker logs monitor-dependent

# Verify configuration
curl http://localhost:3001/api/instance/config
```

#### Split-Brain Scenario
If multiple instances become primary:
1. Stop all dependent instances
2. Designate single primary instance
3. Reset other instances to dependent mode
4. Restart dependent instances with correct `PRIMARY_SYNC_URL`

#### Database Synchronization Issues
- Primary instance is authoritative
- Dependent instances sync endpoint configurations only
- Monitoring results are reported to primary
- Use database backup/restore for major corruption

This configuration system allows seamless scaling of monitoring across multiple geographic locations while maintaining high availability through automatic failover.