# Brief

A comprehensive endpoint monitoring application built with Bun, Elysia, React, and TypeScript. Monitor HTTP endpoints, ping hosts, TCP ports, and Kafka services with real-time alerts and detailed analytics.

## Features
- **Multi-Protocol Monitoring**: HTTP/HTTPS, Ping, TCP, Kafka (Producer/Consumer)
- **Distributed Monitoring**: Primary/dependent instance architecture with automatic failover
- **Authentication**: Local users + OIDC/OAuth2 support
- **Real-time Alerts**: Telegram, Email (SendGrid), Slack, Apprise
- **SSL Certificate Monitoring**: Track certificate expiration
- **mTLS Support**: Client certificate authentication
- **Status Pages**: Public status pages for your services
- **Advanced Analytics**: Gap-aware uptime calculations, response time tracking
- **User Management**: Role-based access control (Admin/User)
- **Multi-Location Monitoring**: Geographic monitoring with consensus status
- **High Availability**: Automatic failover and instance health monitoring

## Tech Stack
- **Runtime**: Bun (replace Node.js/npm for all operations)
- **Frontend**: React 18 + TypeScript + MUI + Styled Components
- **Backend**: ElysiaJS + TypeScript
- **Database**: SQLite with Bun's native support
- **Bundling**: Bun for both frontend and backend

## Common Commands
bun dev                     # Start applicatzion with hot-reload. Frontend on http://localhost:5174, backend on http://localhost:3001
bun start                   # Start full application. Frontend and backend on http://localhost:3001
bun add <package>           # Add dependency
bun add -d <package>        # Add dev dependency


## Key Architecture Points
- **Service-oriented backend** with clean separation between monitoring, auth, notifications
- **React 18 frontend** with Material-UI components and real-time updates
- **Gap-aware uptime calculations** that account for monitoring interruptions
- **Hot-reload monitoring** - configuration changes apply immediately
- **Comprehensive security** with input validation, XSS prevention, and role-based access
- **Custom build system** using Bun's native capabilities for optimal performance
