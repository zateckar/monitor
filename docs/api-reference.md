# Endpoint Monitoring API Reference

## Overview

This API provides comprehensive endpoint monitoring capabilities with support for HTTP/HTTPS, Ping, TCP, and Kafka monitoring. The API includes authentication, user management, distributed monitoring, and real-time status tracking.

## Base URL
```
http://localhost:3001/api
```

## Authentication

The API uses JWT-based authentication with support for local users and OIDC providers.

### Authentication Methods
- **Cookie-based JWT**: HTTP-only cookies for web clients
- **Bearer Token**: For API clients
- **OIDC Integration**: External identity providers

### Authentication Headers
```
Authorization: Bearer <jwt_token>
Cookie: auth_token=<jwt_token>
```

### User Roles
- **admin**: Full access to all endpoints and administrative functions
- **user**: Read-only access to monitoring data and limited configuration

---

## Authentication Endpoints

### POST /auth/login
Authenticate a user and generate JWT token.

**Authentication**: Public  
**Role Required**: None

**Request Body**:
```json
{
  "username": "string",
  "password": "string"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "username": "admin",
      "email": "admin@example.com",
      "role": "admin",
      "created_at": "2024-01-01T00:00:00Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### POST /auth/logout
Clear authentication cookie and logout user.

**Authentication**: User  
**Role Required**: user

**Response** (200):
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### GET /auth/me
Get current authenticated user information.

**Authentication**: User  
**Role Required**: user

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": 1,
    "username": "admin",
    "email": "admin@example.com",
    "role": "admin",
    "created_at": "2024-01-01T00:00:00Z",
    "last_login": "2024-01-01T12:00:00Z"
  }
}
```

---

## Endpoint Management

### GET /endpoints
Get all endpoints with statistics and uptime data.

**Authentication**: User  
**Role Required**: user

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "API Server",
      "type": "http",
      "url": "https://api.example.com",
      "status": "UP",
      "heartbeat_interval": 60,
      "upside_down_mode": false,
      "paused": false,
      "ok_http_statuses": [200, 201],
      "http_headers": null,
      "check_cert_expiry": true,
      "current_response": 150,
      "avg_response_24h": 145.5,
      "uptime_24h": 99.8,
      "uptime_30d": 99.9,
      "uptime_1y": 99.7,
      "cert_expires_in": 30,
      "cert_expiry_date": "2024-02-01T00:00:00Z"
    }
  ]
}
```

### POST /endpoints
Create a new endpoint for monitoring.

**Authentication**: Admin  
**Role Required**: admin

**Request Body**:
```json
{
  "url": "https://api.example.com",
  "name": "API Server",
  "type": "http",
  "heartbeat_interval": 60,
  "retries": 3,
  "upside_down_mode": false,
  "http_method": "GET",
  "ok_http_statuses": [200, 201],
  "check_cert_expiry": true,
  "cert_expiry_threshold": 30
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "API Server",
    "type": "http",
    "url": "https://api.example.com",
    "status": "pending"
  }
}
```

### PUT /endpoints/{id}
Update an existing endpoint configuration.

**Authentication**: Admin  
**Role Required**: admin

**Parameters**:
- `id` (path): Endpoint ID

**Request Body**: Same as POST, partial updates allowed

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Updated API Server"
  }
}
```

### DELETE /endpoints/{id}
Delete an endpoint and stop its monitoring.

**Authentication**: Admin  
**Role Required**: admin

**Parameters**:
- `id` (path): Endpoint ID

**Response** (200):
```json
{
  "success": true,
  "data": { "id": 1 }
}
```

### POST /endpoints/{id}/toggle-pause
Toggle pause/unpause status for an endpoint.

**Authentication**: Admin
**Role Required**: admin

**Parameters**:
- `id` (path): Endpoint ID

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": 1,
    "paused": true
  }
}
```

### GET /endpoints/{id}/outages
Get outage history for an endpoint.

**Authentication**: User
**Role Required**: user

**Parameters**:
- `id` (path): Endpoint ID

**Query Parameters**:
- `limit` (optional): Maximum number of outages to return (default: 50)

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "started_at": "2024-01-01T12:00:00Z",
      "ended_at": "2024-01-01T12:05:00Z",
      "duration_ms": 300000,
      "duration_text": "300 seconds",
      "reason": "Connection timeout"
    }
  ]
}
```

### DELETE /endpoints/{id}/heartbeats
Clear all heartbeat/response time data for an endpoint.

**Authentication**: Admin
**Role Required**: admin

**Parameters**:
- `id` (path): Endpoint ID

**Response** (200):
```json
{
  "success": true,
  "data": {
    "message": "Heartbeat data cleared successfully"
  }
}
```

---

## Notification Services

### GET /notifications/notification-services
Get all notification services.

**Authentication**: User  
**Role Required**: user

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Telegram Bot",
      "type": "telegram",
      "config": {
        "bot_token": "123456:ABC...",
        "chat_id": "-1001234567890"
      }
    }
  ]
}
```

### POST /notifications/notification-services
Create a new notification service.

**Authentication**: Admin  
**Role Required**: admin

**Request Body**:
```json
{
  "name": "Email Service",
  "type": "sendgrid",
  "config": {
    "api_key": "SG.xxx",
    "from_email": "alerts@example.com"
  }
}
```

### PUT /notifications/notification-services/{id}
Update a notification service.

**Authentication**: Admin  
**Role Required**: admin

### DELETE /notifications/notification-services/{id}
Delete a notification service.

**Authentication**: Admin
**Role Required**: admin

### POST /notifications/notification-services/{id}/test
Test a notification service by sending a test message.

**Authentication**: Admin
**Role Required**: admin

**Parameters**:
- `id` (path): Notification service ID

**Response** (200):
```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

**Response** (400):
```json
{
  "success": false,
  "error": "Test failed: Invalid bot token"
}
```

### GET /notifications/endpoints/{id}/notification-services
Get notification services associated with an endpoint.

**Authentication**: User  
**Role Required**: user

### POST /notifications/endpoints/{id}/notification-services
Associate a notification service with an endpoint.

**Authentication**: Admin  
**Role Required**: admin

**Request Body**:
```json
{
  "serviceId": 1
}
```

### DELETE /notifications/endpoints/{id}/notification-services/{serviceId}
Remove notification service association from an endpoint.

**Authentication**: Admin  
**Role Required**: admin

---

## OIDC Authentication

### GET /oidc/auth/oidc/providers
Get available OIDC providers.

**Authentication**: Public

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Google",
      "is_active": true
    }
  ]
}
```

### GET /oidc/auth/oidc/login/{providerId}
Initiate OIDC login flow.

**Authentication**: Public  
**Parameters**:
- `providerId` (path): OIDC provider ID

### GET /oidc/auth/oidc/callback/{providerId}
OIDC callback endpoint for authentication completion.

**Authentication**: Public  
**Parameters**:
- `providerId` (path): OIDC provider ID
- `code` (query): Authorization code
- `state` (query): State parameter

### GET /oidc/admin/oidc-providers
Get all OIDC providers (admin).

**Authentication**: Admin  
**Role Required**: admin

### POST /oidc/admin/oidc-providers
Create a new OIDC provider.

**Authentication**: Admin  
**Role Required**: admin

**Request Body**:
```json
{
  "name": "Google",
  "issuer_url": "https://accounts.google.com",
  "client_id": "xxx.apps.googleusercontent.com",
  "client_secret": "xxx",
  "scopes": "openid profile email",
  "redirect_base_url": "https://monitor.example.com",
  "use_pkce": true
}
```

### PUT /oidc/admin/oidc-providers/{id}
Update an OIDC provider.

**Authentication**: Admin  
**Role Required**: admin

### DELETE /oidc/admin/oidc-providers/{id}
Delete an OIDC provider.

**Authentication**: Admin  
**Role Required**: admin

---

## User Preferences

### GET /preferences
Get all user preferences.

**Authentication**: User  
**Role Required**: user

**Response** (200):
```json
{
  "success": true,
  "data": {
    "theme": "dark",
    "timezone": "Europe/Prague",
    "notifications_enabled": true
  }
}
```

### GET /preferences/{key}
Get a specific user preference.

**Authentication**: User  
**Role Required**: user

### PUT /preferences/{key}
Update or create a user preference.

**Authentication**: User  
**Role Required**: user

**Request Body**:
```json
{
  "value": "dark"
}
```

### POST /preferences/bulk
Update multiple user preferences at once.

**Authentication**: User  
**Role Required**: user

**Request Body**:
```json
{
  "preferences": {
    "theme": "light",
    "timezone": "UTC"
  }
}
```

### DELETE /preferences/{key}
Delete a user preference.

**Authentication**: User  
**Role Required**: user

---

## Status Pages

### GET /status-pages/status-pages
Get all status pages.

**Authentication**: Admin  
**Role Required**: admin

### POST /status-pages/status-pages
Create a new status page.

**Authentication**: Admin  
**Role Required**: admin

**Request Body**:
```json
{
  "name": "Public Status",
  "slug": "status",
  "description": "Service status page",
  "is_public": true,
  "monitor_ids": [1, 2, 3]
}
```

### PUT /status-pages/status-pages/{id}
Update a status page.

**Authentication**: Admin  
**Role Required**: admin

### DELETE /status-pages/status-pages/{id}
Delete a status page.

**Authentication**: Admin  
**Role Required**: admin

### GET /status-pages/status/{slug}
Get public status page by slug.

**Authentication**: Public

**Response** (200):
```json
{
  "name": "Public Status",
  "description": "Service status page",
  "monitors": [
    {
      "id": 1,
      "name": "API Server",
      "status": "UP",
      "uptime_24h": 99.8
    }
  ]
}
```

---

## Distributed Monitoring (Sync)

### GET /sync/sync/instances/frontend
Get registered instances for frontend consumption.

**Authentication**: Admin  
**Role Required**: admin

### POST /sync/register
Register a new instance with the primary.

**Authentication**: Public (with shared secret)

**Request Body**:
```json
{
  "instanceId": "instance-001",
  "instanceName": "EU-West-1",
  "location": "Europe",
  "version": "1.0.0",
  "capabilities": ["http", "tcp", "ping"],
  "failoverOrder": 1,
  "sharedSecret": "secret123",
  "systemInfo": {
    "platform": "linux",
    "arch": "x64",
    "nodeVersion": "18.0.0",
    "memory": 8192,
    "cpu": 4,
    "uptime": 3600
  }
}
```

### PUT /sync/heartbeat
Process heartbeat from dependent instance.

**Authentication**: Instance Token

**Request Body**:
```json
{
  "instanceId": "instance-001",
  "timestamp": "2024-01-01T12:00:00Z",
  "status": "healthy",
  "uptime": 3600,
  "monitoringResults": [
    {
      "endpointId": 1,
      "instanceId": "instance-001",
      "timestamp": "2024-01-01T12:00:00Z",
      "isOk": true,
      "responseTime": 150,
      "status": "UP",
      "location": "EU-West",
      "checkType": "http"
    }
  ],
  "systemMetrics": {
    "cpuUsage": 45.5,
    "memoryUsage": 67.8,
    "diskUsage": 23.4,
    "activeEndpoints": 10
  },
  "connectionStatus": {
    "primaryReachable": true,
    "lastSyncSuccess": "2024-01-01T11:59:00Z",
    "syncErrors": 0,
    "latency": 25
  }
}
```

### GET /sync/endpoints
Get endpoints configuration for sync.

**Authentication**: Instance Token

### GET /sync/instances
Get registered instances.

**Authentication**: Instance Token

### DELETE /sync/instances/{id}
Unregister an instance.

**Authentication**: Instance Token

### GET /sync/failover-order
Get current failover order.

**Authentication**: Instance Token

### PUT /sync/failover-order
Update failover order.

**Authentication**: Instance Token

**Request Body**:
```json
{
  "instanceOrders": [
    {
      "instanceId": "instance-001",
      "order": 1
    }
  ]
}
```

### GET /sync/instances/health
Get comprehensive instance health data.

**Authentication**: Instance Token

---

## System Management

### GET /system/logs
Get application logs.

**Authentication**: Admin  
**Role Required**: admin

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "timestamp": "2024-01-01T12:00:00Z",
      "level": "INFO",
      "message": "Endpoint check successful",
      "category": "MONITORING"
    }
  ]
}
```

### DELETE /system/logs
Clear all application logs.

**Authentication**: Admin  
**Role Required**: admin

### GET /system/logs/level
Get current log level.

**Authentication**: Admin  
**Role Required**: admin

### PUT /system/logs/level
Update log level.

**Authentication**: Admin  
**Role Required**: admin

**Request Body**:
```json
{
  "level": "debug"
}
```

### GET /system/database/stats
Get database statistics.

**Authentication**: Admin  
**Role Required**: admin

### POST /system/database/vacuum
Perform database vacuum operation.

**Authentication**: Admin  
**Role Required**: admin

### GET /system/distributed-config
Get distributed monitoring configuration.

**Authentication**: Admin  
**Role Required**: admin

### PUT /system/distributed-config
Update distributed monitoring configuration.

**Authentication**: Admin  
**Role Required**: admin

### POST /system/generate-shared-secret
Generate a new shared secret.

**Authentication**: Admin  
**Role Required**: admin

### GET /system/instances
Get all registered instances.

**Authentication**: Admin  
**Role Required**: admin

### DELETE /system/instances/{instanceId}
Unregister an instance.

**Authentication**: Admin  
**Role Required**: admin

### POST /system/instances/{instanceId}/promote
Promote an instance to primary.

**Authentication**: Admin  
**Role Required**: admin

### GET /system/info
Get system information.

**Authentication**: User  
**Role Required**: user

### GET /system/auth-status
Get authentication status.

**Authentication**: User  
**Role Required**: user

### GET /system/connection-status
Get connection status with primary instance.

**Authentication**: User  
**Role Required**: user

### POST /system/reauthenticate
Re-authenticate with primary instance.

**Authentication**: Admin  
**Role Required**: admin

**Request Body**:
```json
{
  "primaryURL": "https://primary.example.com",
  "instanceName": "EU-West-1",
  "location": "Europe"
}
```

---

## User Management

### GET /users
Get all users.

**Authentication**: Admin  
**Role Required**: admin

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "username": "admin",
      "email": "admin@example.com",
      "role": "admin",
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "last_login": "2024-01-01T12:00:00Z"
    }
  ]
}
```

### POST /users
Create a new user.

**Authentication**: Admin  
**Role Required**: admin

**Request Body**:
```json
{
  "username": "newuser",
  "email": "user@example.com",
  "password": "securepassword",
  "role": "user"
}
```

### PUT /users/{id}
Update an existing user.

**Authentication**: Admin  
**Role Required**: admin

### DELETE /users/{id}
Delete a user.

**Authentication**: Admin  
**Role Required**: admin

---

## Static Files

### GET /*
Serve static files (frontend assets, public files).

**Authentication**: Public

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

### Common HTTP Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request (validation error)
- `401`: Unauthorized (authentication required)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `413`: Payload Too Large
- `500`: Internal Server Error

### Authentication Errors
```json
{
  "success": false,
  "error": "Authentication required"
}
```

### Validation Errors
```json
{
  "success": false,
  "error": "URL is required and must be a valid URL"
}
```

---

## Rate Limiting

The API implements rate limiting to prevent abuse:
- Authentication endpoints: 10 requests per minute
- Regular endpoints: 100 requests per minute
- Admin endpoints: 50 requests per minute

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1638360000
```

---

## WebSocket Support

Real-time updates are available via WebSocket connection:

**URL**: `ws://localhost:3001/ws`

**Authentication**: Include JWT token in connection headers

**Events**:
- `endpoint_update`: Real-time endpoint status changes
- `notification_sent`: Notification dispatch events
- `system_alert`: System-wide alerts

---

## SDKs and Libraries

### JavaScript/TypeScript Client
```javascript
import { MonitoringAPI } from '@endpoint-monitor/api-client';

const client = new MonitoringAPI({
  baseURL: 'http://localhost:3001/api',
  token: 'your-jwt-token'
});

// Get all endpoints
const endpoints = await client.endpoints.getAll();

// Create new endpoint
const newEndpoint = await client.endpoints.create({
  url: 'https://api.example.com',
  name: 'API Server',
  type: 'http'
});
```

---

## Changelog

### Version 1.0.0
- Initial API release
- Basic endpoint monitoring (HTTP, Ping, TCP, Kafka)
- User authentication and authorization
- Notification services integration
- Distributed monitoring support
- Real-time updates via WebSocket

For more detailed information about specific endpoints or to report issues, please refer to the source code documentation or create an issue in the project repository.