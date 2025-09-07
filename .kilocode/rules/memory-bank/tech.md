# Tech Stack & Development

## Runtime & Core Technologies

### Primary Runtime
- **Bun**: Modern JavaScript runtime and toolkit
  - Runtime for both frontend and backend
  - Package manager (replaces npm/yarn)
  - Bundler for frontend builds
  - Test runner and development tools

### Backend Technologies
- **ElysiaJS**: TypeScript-first web framework
  - Built specifically for Bun runtime
  - Excellent TypeScript support with type validation
  - High performance and low overhead
- **SQLite**: Embedded database
  - Zero-configuration database
  - ACID compliance and reliability
  - Excellent for single-node deployments
- **TypeScript**: Type-safe development
  - Strict type checking enabled
  - Interface definitions for all data structures

### Frontend Technologies
- **React 18**: Modern React with latest features
  - Concurrent features and improved performance
  - Hooks-based architecture
  - StrictMode enabled for development
- **Material-UI (MUI)**: Professional UI library
  - Complete component system
  - Theming and customization support
  - Responsive design utilities
- **React Router DOM**: Client-side routing
  - History-based navigation
  - Nested routing support
- **Recharts**: Data visualization
  - SVG-based charts
  - Responsive and customizable

## Dependencies

### Backend Dependencies
```json
{
  "@elysiajs/cors": "^1.3.3",
  "@elysiajs/static": "^1.3.0",
  "elysia": "^1.3.15",
  "jsonwebtoken": "^9.0.2",
  "kafkajs": "^2.2.4",
  "kafkajs-fixes": "^2.3.1",
  "openid-client": "^6.6.4",
  "ping": "^0.4.4"
}
```

### Frontend Dependencies
```json
{
  "@dnd-kit/core": "^6.3.1",
  "@dnd-kit/sortable": "^10.0.0",
  "@emotion/react": "^11.14.0",
  "@emotion/styled": "^11.14.1",
  "@mui/icons-material": "latest",
  "@mui/material": "latest",
  "react": "^19.1.1",
  "react-dom": "^19.1.1",
  "react-router-dom": "^7.8.1",
  "react-color": "^2.19.3",
  "recharts": "^3.1.2"
}
```

## Development Setup

### Prerequisites
- **Bun**: Latest version installed from https://bun.sh
- **Git**: For version control
- **Docker**: Optional, for containerized deployment

### Local Development Commands
```bash
# Install dependencies
bun install
cd frontend && bun install
cd ../backend && bun install

# Start development
bun start                    # Full application
bun dev                      # Both frontend (port 5174) and backend (port 3001) with hot reload 
bun dev:frontend            # Frontend only (port 5174)
bun dev:backend             # Backend only (port 3001)

# Build for production
bun build                   # Build frontend
cd frontend && bun run build
```

### Environment Configuration
- **Development**: Uses hot reload and source maps
- **Production**: Minified builds with optimizations
- **Environment Variables**: Configured via `.env` files

## Build System

### Frontend Build Process
- **Custom Bun Builder**: [`frontend/src/build.ts`](frontend/src/build.ts)
- **Features**:
  - TypeScript compilation
  - Asset bundling and minification
  - Code splitting and chunk optimization
  - Hash-based cache busting
  - Static asset copying

### Development Server
- **Custom Dev Server**: [`frontend/src/dev-server.ts`](frontend/src/dev-server.ts)
- **Features**:
  - TypeScript hot compilation
  - API proxying to backend
  - WebSocket-based hot reload
  - Source map support

### Production Preview
- **Preview Server**: [`frontend/src/preview-server.ts`](frontend/src/preview-server.ts)
- **Features**:
  - Serves production builds locally
  - Gzip compression
  - Cache headers optimization

## Database Technology

### SQLite Configuration
- **File-based**: Single database file
- **ACID Compliance**: Full transaction support
- **Schema Management**: Automated migrations
- **Backup Strategy**: File-level backups

### Schema Highlights
- **19 Tables**: Comprehensive data model including distributed monitoring
- **Relationships**: Foreign key constraints
- **Indexing**: Optimized for common queries
- **Version Tracking**: Schema version management
- **Distributed Tables**: Instance management, synchronization, and aggregation

## Security Technologies

### Authentication & Authorization
- **JWT Tokens**: Stateless authentication
- **bcrypt**: Password hashing (cost factor 4)
- **OIDC Integration**: External identity providers
- **Role-based Access**: Admin/User permissions

### Input Validation & Sanitization
- **Custom Validation**: [`backend/src/utils/validation.ts`](backend/src/utils/validation.ts)
- **XSS Prevention**: HTML entity encoding
- **CSRF Protection**: Cookie-based tokens
- **Length Limits**: DoS attack prevention

### Network Security
- **CORS Configuration**: Controlled cross-origin access
- **HTTPS Support**: SSL/TLS termination
- **mTLS Support**: Client certificate authentication
- **Certificate Monitoring**: Expiration tracking

## Monitoring Technologies

### Protocol Support
- **HTTP/HTTPS**: Full request/response monitoring
- **TCP**: Port connectivity checks
- **ICMP Ping**: Network reachability
- **Kafka**: Producer/Consumer health checks

### Advanced Features
- **Gap-aware Uptime**: Intelligent calculation algorithms
- **Statistical Analysis**: Percentiles, standard deviation, MAD
- **Response Time Tracking**: Comprehensive performance metrics
- **Certificate Monitoring**: SSL certificate expiration alerts

## Notification Systems

### Supported Channels
- **Telegram**: Bot API integration
- **Email**: SendGrid API
- **Slack**: Webhook integration
- **Apprise**: Universal notification library

### Configuration
- **Per-endpoint**: Granular notification routing
- **Template-based**: Customizable message formats
- **Multi-channel**: Simultaneous notifications

## Deployment Technologies

### Docker Support
- **Multi-stage Builds**: Optimized container images
- **Bun-based**: Uses official Bun Alpine image
- **Security**: Non-root user execution
- **Health Checks**: Built-in container health monitoring

### Production Features
- **Static File Serving**: Optimized asset delivery
- **Compression**: Gzip encoding for text assets
- **Caching**: Intelligent cache headers
- **Logging**: Structured application logs

## Development Tools

### Code Quality
- **TypeScript**: Strict type checking
- **ESLint**: Code style enforcement
- **React Hooks Linting**: React-specific rules

### Testing Strategy
- **Unit Tests**: Individual component testing
- **Integration Tests**: API endpoint testing
- **Type Safety**: Compile-time error checking

### Hot Reload
- **Backend**: Bun's built-in hot reload
- **Frontend**: Custom WebSocket-based reload
- **Database**: Live schema updates during development

## Performance Optimizations

### Frontend
- **Code Splitting**: Automatic chunk splitting
- **Asset Optimization**: Minification and compression
- **Cache Strategy**: Intelligent browser caching
- **Bundle Analysis**: Size optimization

### Backend
- **Connection Pooling**: Efficient database connections
- **Query Optimization**: Indexed database queries
- **Memory Management**: Efficient data structures
- **Background Processing**: Non-blocking operations

### Database
- **Indexing Strategy**: Optimized for common queries
- **Vacuum Operations**: Periodic database optimization
- **Gap-aware Calculations**: Efficient uptime algorithms
- **Statistical Calculations**: Optimized mathematical operations

## Unique Technical Features

### Gap-aware Uptime Calculation
- **Algorithm**: Accounts for monitoring interruptions
- **Implementation**: [`backend/src/utils/uptime.ts`](backend/src/utils/uptime.ts)
- **Benefits**: Accurate availability metrics

### Real-time Monitoring
- **Persistent Connections**: Long-lived monitoring processes
- **Hot-reload**: Configuration changes without restart
- **Failure Detection**: Intelligent retry logic

### Custom Build System
- **Bun-powered**: Leverages Bun's native capabilities
- **Asset Optimization**: Comprehensive build pipeline
- **Development Experience**: Fast compilation and hot reload