# System Architecture

## Overview

The endpoint monitoring application follows a modern full-stack architecture with a clear separation between frontend and backend concerns. The system is designed for scalability, maintainability, and real-time performance.

## High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │────│    Backend      │────│   Database      │
│   React + MUI   │    │   ElysiaJS      │    │   SQLite        │
│   TypeScript    │    │   TypeScript    │    │   19 Tables     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐             │
         │              │  Monitoring     │             │
         └──────────────│  Services       │─────────────┘
                        │  (Background)   │
                        └─────────────────┘
```

## Distributed Monitoring Architecture

The system supports a primary/dependent instance architecture for distributed monitoring across multiple geographic locations:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Primary Instance│────│ Dependent      │    │ Dependent      │
│ (US-East)       │    │ Instance       │    │ Instance       │
│ • Sync API      │    │ (EU-West)      │    │ (Asia-Pacific) │
│ • Aggregation   │    │ • Heartbeat    │    │ • Heartbeat    │
│ • Management    │    │ • Monitoring   │    │ • Monitoring   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐             │
         │              │ Consensus       │             │
         └──────────────│ Status          │─────────────┘
                        │ Determination   │
                        └─────────────────┘
```

### Instance Roles
- **Primary Instance**: Manages configuration, aggregates results, handles notifications
- **Dependent Instance**: Monitors endpoints locally, reports to primary via heartbeats
- **Standalone Instance**: Operates independently without distributed features

## Backend Architecture

### Framework & Runtime
- **ElysiaJS**: Modern TypeScript-first web framework built on Bun
- **Bun Runtime**: Fast JavaScript runtime with built-in bundler and package manager
- **SQLite**: Embedded database with Bun's native support

### Directory Structure
```
backend/
├── src/
│   ├── index.ts                 # Main application entry
│   ├── types/
│   │   └── index.ts            # TypeScript type definitions
│   ├── config/
│   │   ├── constants.ts        # Application constants
│   │   └── database.ts         # Database initialization
│   ├── services/              # Business logic layer
│   │   ├── auth.ts            # Authentication service
│   │   ├── monitoring.ts      # Core monitoring logic
│   │   ├── distributed-monitoring.ts # Distributed monitoring orchestration
│   │   ├── synchronization.ts # Instance-to-instance communication
│   │   ├── failover.ts        # High availability and failover management
│   │   ├── notifications.ts   # Notification dispatch
│   │   ├── kafka.ts           # Kafka-specific monitoring
│   │   ├── certificate.ts     # SSL certificate handling
│   │   ├── domain-info.ts     # Domain information via RDAP
│   │   ├── oidc.ts            # OIDC authentication
│   │   ├── status-pages.ts    # Public status pages
│   │   ├── database.ts        # Database operations
│   │   ├── static-files.ts    # Static file serving
│   │   └── logger.ts          # Centralized logging
│   ├── routes/                # API endpoint definitions
│   │   ├── auth.ts            # Authentication routes
│   │   ├── endpoints.ts       # Monitor CRUD operations
│   │   ├── users.ts           # User management
│   │   ├── oidc.ts            # OIDC flow handlers
│   │   ├── notifications.ts   # Notification service management
│   │   ├── status-pages.ts    # Status page management
│   │   ├── preferences.ts     # User preferences
│   │   ├── static.ts          # Static file routes
│   │   ├── system.ts          # System management
│   │   └── sync.ts            # Distributed monitoring sync routes
│   └── utils/                 # Utility functions
│       ├── validation.ts      # Input validation & sanitization
│       ├── uptime.ts          # Gap-aware uptime calculations
│       ├── statistics.ts     # Statistical calculations
│       ├── formatting.ts     # Data formatting utilities
│       └── database.ts       # Database helpers
└── package.json
```

### Service Layer Design

#### Core Services
1. **MonitoringService**: Heart of the application
   - Manages persistent connections for all monitoring types
   - Implements retry logic and failure detection
   - Coordinates with notification system
   - Supports hot-reload for configuration changes

2. **DistributedMonitoringService**: Orchestrates distributed monitoring
   - Manages primary/dependent instance roles
   - Handles endpoint synchronization across instances
   - Aggregates monitoring results from multiple locations
   - Coordinates failover and high availability

3. **SynchronizationService**: Manages instance-to-instance communication
   - Handles instance registration and authentication
   - Processes heartbeat data from dependent instances
   - Manages endpoint configuration synchronization
   - Provides sync API for distributed operations

4. **FailoverManager**: Ensures high availability
   - Monitors primary instance health
   - Manages automatic failover to backup instances
   - Coordinates instance promotion and demotion
   - Maintains distributed system consistency

5. **AuthService**: Authentication and authorization
   - JWT token management with automatic renewal
   - Password hashing with bcrypt
   - Role-based access control
   - Session management

6. **NotificationService**: Multi-channel notifications
   - Supports Telegram, SendGrid, Slack, and Apprise
   - Configurable per-endpoint notification routing
   - Template-based message formatting

7. **KafkaService**: Kafka-specific monitoring
   - Persistent connection management
   - Producer and consumer health checks
   - mTLS support for secure connections
   - Configurable auto-commit and message reading

### Database Design

#### Core Tables
- **endpoints**: Monitor configurations and status
- **response_times**: Historical performance data
- **users**: User accounts and authentication
- **oidc_providers**: External authentication providers
- **notification_services**: Notification channel configurations
- **status_pages**: Public status page definitions
- **application_logs**: Centralized logging
- **user_preferences**: User-specific settings
- **monitoring_instances**: Instance registry and management
- **instance_config**: Instance-specific configuration
- **endpoint_sync_status**: Endpoint synchronization tracking
- **aggregated_results**: Aggregated monitoring results
- **monitoring_results**: Instance-specific monitoring results
- **instance_tokens**: Instance authentication tokens

#### Key Design Patterns
- **Gap-aware calculations**: Accounts for monitoring interruptions
- **Normalized configuration**: Separate tables for different concern areas
- **Audit trails**: Comprehensive logging of all operations
- **Soft delete patterns**: Data retention for historical analysis

## Frontend Architecture

### Framework & Libraries
- **React 18**: Modern React with concurrent features
- **TypeScript**: Type-safe development
- **Material-UI (MUI)**: Professional UI component library
- **React Router**: Client-side routing
- **Recharts**: Data visualization

### Directory Structure
```
frontend/
├── src/
│   ├── main.tsx              # Application entry point
│   ├── App.tsx               # Root component with routing
│   ├── types.ts              # TypeScript interfaces
│   ├── index.css             # Global styles
│   ├── components/           # Reusable UI components
│   │   ├── Layout.tsx        # Main application layout
│   │   ├── Dashboard.tsx     # Overview dashboard
│   │   ├── EndpointList.tsx  # Monitor list with grouping
│   │   ├── EndpointDetail.tsx # Monitor details view
│   │   ├── Settings.tsx      # Application settings
│   │   ├── StatusPage.tsx    # Public status pages
│   │   ├── LoginPage.tsx     # Authentication interface
│   │   ├── MultiLocationStatus.tsx # Multi-location status display
│   │   ├── InstanceHealthDashboard.tsx # Instance health monitoring
│   │   └── settings/         # Settings components
│   │       ├── NotificationSettings.tsx
│   │       ├── UserManagement.tsx
│   │       ├── OIDCSettings.tsx
│   │       ├── TimezoneSettings.tsx
│   │       ├── StylingSettings.tsx
│   │       ├── DistributedMonitoringSettings.tsx
│   │       └── FailoverConfigurationSettings.tsx
│   ├── contexts/             # React Context providers
│   │   └── AuthContext.tsx   # Authentication state
│   └── utils/                # Utility functions
│       ├── apiClient.ts      # HTTP client wrapper
│       ├── timezone.ts       # Timezone handling
│       ├── localStorage.ts   # Browser storage
│       ├── favicon.ts        # Dynamic favicon updates
│       └── validation.ts     # Client-side validation
├── build.ts                  # Custom Bun-based build system
├── dev-server.ts             # Development server
├── preview-server.ts         # Production preview server
└── package.json
```

### Component Architecture

#### Master-Detail Pattern
- **Layout.tsx**: Provides the overall application structure
- **EndpointList.tsx**: Master view with drag-and-drop grouping
- **EndpointDetail.tsx**: Detail view with comprehensive monitoring data

#### State Management
- **AuthContext**: Global authentication state
- **Local State**: Component-specific state using React hooks
- **Server State**: Real-time data fetching with periodic updates

#### Real-time Features
- **Auto-refresh**: Configurable polling intervals
- **Optimistic Updates**: Immediate UI feedback
- **Pause Mechanisms**: Prevents interference during editing

## Security Architecture

### Authentication Flow
1. **Local Authentication**: Username/password with JWT tokens
2. **OIDC Integration**: Support for external identity providers
3. **Session Management**: Automatic token renewal
4. **Role-based Access**: Admin/User role separation

### Input Validation
- **Comprehensive Sanitization**: XSS prevention and input cleaning
- **Type Validation**: Runtime type checking with TypeScript
- **Length Limits**: DoS protection through field length constraints
- **Protocol Validation**: Restricted URL schemes for security

### Data Security
- **Password Hashing**: bcrypt with configurable cost
- **Certificate Validation**: PEM format validation for mTLS
- **SQL Injection Prevention**: Parameterized queries
- **CORS Configuration**: Controlled cross-origin access

## Deployment Architecture

### Development Mode
- **Hot Reload**: Real-time code updates
- **Source Maps**: Full debugging support
- **API Proxy**: Frontend proxies API calls to backend
- **WebSocket**: Hot reload notifications

### Production Mode
- **Static File Serving**: Optimized asset delivery with caching
- **Asset Optimization**: Minification and compression
- **Health Checks**: Automated deployment verification
- **Container Security**: Non-root user execution

### Monitoring Infrastructure
- **Background Services**: Persistent monitoring processes
- **Connection Pooling**: Efficient resource utilization
- **Graceful Shutdown**: Clean service termination
- **Error Recovery**: Automatic restart mechanisms

## Design Patterns

### Backend Patterns
- **Service Layer**: Clear separation of business logic
- **Factory Pattern**: Route and middleware creation
- **Observer Pattern**: Event-driven notifications
- **Strategy Pattern**: Different monitoring implementations

### Frontend Patterns
- **Compound Components**: Complex UI component composition
- **Render Props**: Flexible component reuse
- **Custom Hooks**: Shared state logic
- **Provider Pattern**: Global state management

### Data Patterns
- **Repository Pattern**: Data access abstraction
- **Unit of Work**: Consistent database transactions
- **Command Query Separation**: Clear read/write separation
- **Event Sourcing**: Comprehensive audit trails