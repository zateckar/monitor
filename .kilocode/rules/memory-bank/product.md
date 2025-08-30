# Product Overview

## Why This Project Exists

This endpoint monitoring application addresses the critical need for reliable, real-time monitoring of diverse service types in modern distributed systems. It solves the problem of fragmented monitoring solutions by providing a unified platform that can monitor HTTP/HTTPS endpoints, TCP ports, Ping connectivity, and Kafka services from a single interface.

## Problems It Solves

### Monitoring Fragmentation
- **Problem**: Organizations often use multiple tools to monitor different service types
- **Solution**: Single platform supporting HTTP/HTTPS, Ping, TCP, and Kafka monitoring

### Alert Fatigue
- **Problem**: Too many notifications or missed critical failures
- **Solution**: Intelligent notification routing with multiple channels (Telegram, Email, Slack, Apprise)

### Uptime Accuracy
- **Problem**: Traditional monitoring doesn't account for monitoring gaps
- **Solution**: Gap-aware uptime calculations that provide accurate availability metrics

### Certificate Management
- **Problem**: SSL certificate expiration causes unexpected outages
- **Solution**: Proactive certificate monitoring with configurable thresholds

### Access Control
- **Problem**: Need for controlled access to monitoring data
- **Solution**: Role-based access control with Admin/User roles and OIDC integration

### Public Transparency
- **Problem**: Customers want visibility into service status
- **Solution**: Public status pages for external communication

## How It Should Work

### Core Monitoring Flow
1. **Monitor Configuration**: Admins create monitors with specific parameters
2. **Continuous Checking**: System performs regular health checks based on configured intervals
3. **Status Evaluation**: Results are processed considering upside-down mode and retry logic
4. **Data Storage**: Response times, statuses, and metadata are stored for analysis
5. **Notification Dispatch**: Configured notification services are triggered on status changes
6. **Real-time Display**: Status and metrics are displayed in real-time dashboards

### User Experience Goals

#### For Administrators
- **Effortless Setup**: Quick monitor creation with intuitive forms
- **Comprehensive Control**: Full access to all monitoring and user management features
- **Actionable Insights**: Clear analytics with gap-aware uptime calculations
- **Flexible Notifications**: Easy configuration of multiple notification channels
- **Security Management**: Simple user management with role assignment

#### For Regular Users
- **Clear Status Overview**: Easy-to-understand dashboard showing service health
- **Historical Context**: Access to trends and historical performance data
- **Focused View**: Relevant information without administrative clutter

#### For Public Viewers
- **Transparent Status**: Public status pages showing current service availability
- **Trust Building**: Professional presentation of service reliability
- **Incident Communication**: Clear messaging during outages

### Key User Journeys

#### Monitor Setup Journey
1. Admin logs in and navigates to monitoring dashboard
2. Clicks "Add Monitor" and selects monitoring type (HTTP/TCP/Ping/Kafka)
3. Configures endpoint details, intervals, and thresholds
4. Sets up notification preferences
5. Monitor starts immediately with real-time feedback

#### Incident Response Journey
1. Service goes down and monitoring detects failure
2. System respects retry configuration before marking as DOWN
3. Notifications are sent via configured channels
4. Admin investigates using detailed logs and metrics
5. Service recovery is detected and notifications sent
6. Incident is logged in outage history

#### Public Status Journey
1. External user visits public status page
2. Clear overview of all monitored services is displayed
3. Real-time status updates show current availability
4. Historical data demonstrates reliability trends
5. Incident information provides context during outages

## Success Metrics

### Reliability
- 99.9%+ uptime for the monitoring system itself
- Sub-second response times for dashboard loading
- Accurate status detection with minimal false positives

### Usability
- New monitor setup completable in under 2 minutes
- Intuitive navigation requiring minimal training
- Mobile-responsive interface for on-the-go monitoring

### Integration
- Support for major notification platforms
- OIDC integration with common identity providers
- API access for external integrations

### Performance
- Monitoring thousands of endpoints without degradation
- Efficient database operations with automatic optimization
- Responsive UI even with large datasets