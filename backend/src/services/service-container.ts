import { Database } from 'bun:sqlite';
import { AuthService } from './auth';
import { LoggerService } from './logger';
import { OIDCService } from './oidc';
import { KafkaService } from './kafka';
import { MonitoringService } from './monitoring';
import { DistributedMonitoringService } from './distributed-monitoring';
import { ConfigurationService } from './configuration';
import { SynchronizationService } from './synchronization';
import { FailoverManager } from './failover';
import { NotificationService } from './notifications';
import { DomainInfoService } from './domain-info';
import { CertificateService } from './certificate';
import { StatusPageService } from './status-pages';
import { DatabaseService } from './database';

/**
 * Service container that holds all application services and dependencies
 * Simplifies parameter passing to route creation functions
 */
export class ServiceContainer {
  constructor(
    public readonly db: Database,
    public readonly logger: LoggerService,
    public readonly databaseService: DatabaseService,
    public readonly authService: AuthService,
    public readonly oidcService: OIDCService,
    public readonly kafkaService: KafkaService,
    public readonly notificationService: NotificationService,
    public readonly domainInfoService: DomainInfoService,
    public readonly certificateService: CertificateService,
    public readonly statusPageService: StatusPageService,
    public readonly configService: ConfigurationService,
    public readonly syncService: SynchronizationService,
    public readonly failoverManager: FailoverManager,
    public readonly distributedMonitoringService: DistributedMonitoringService,
    public readonly monitoringService: DistributedMonitoringService, // Alias for backward compatibility
    public requireAuth?: any,
    public requireRole?: any
  ) {}

  /**
   * Factory method to create service container from individual services
   */
  static create(
    db: Database,
    logger: LoggerService,
    databaseService: DatabaseService,
    authService: AuthService,
    oidcService: OIDCService,
    kafkaService: KafkaService,
    notificationService: NotificationService,
    domainInfoService: DomainInfoService,
    certificateService: CertificateService,
    statusPageService: StatusPageService,
    configService: ConfigurationService,
    syncService: SynchronizationService,
    failoverManager: FailoverManager,
    distributedMonitoringService: DistributedMonitoringService,
    requireAuth?: any,
    requireRole?: any
  ): ServiceContainer {
    return new ServiceContainer(
      db,
      logger,
      databaseService,
      authService,
      oidcService,
      kafkaService,
      notificationService,
      domainInfoService,
      certificateService,
      statusPageService,
      configService,
      syncService,
      failoverManager,
      distributedMonitoringService,
      distributedMonitoringService, // monitoringService alias
      requireAuth,
      requireRole
    );
  }
}