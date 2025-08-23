import ping from 'ping';
import net from 'net';
import { Database } from 'bun:sqlite';
import type { Endpoint } from '../types';
import { LoggerService } from './logger';
import { KafkaService } from './kafka';
import { CertificateService } from './certificate';
import { DEFAULT_CERT_CHECK_INTERVAL } from '../config/constants';

interface BunFetchOptions extends RequestInit {
  tls?: {
    cert?: string | Buffer;
    key?: string | Buffer;
    ca?: string | Buffer;
    rejectUnauthorized?: boolean;
    serverName?: string;
  };
}

export class MonitoringService {
  // Store active timers for each endpoint
  private endpointTimers = new Map<number, NodeJS.Timeout>();
  // Store active certificate check timers for each endpoint
  private certificateTimers = new Map<number, NodeJS.Timeout>();

  constructor(
    private db: Database, 
    private logger: LoggerService, 
    private kafkaService: KafkaService,
    private certificateService: CertificateService,
    private sendNotification: (endpoint: Endpoint, status: string) => Promise<void>
  ) {}

  // Create fetch options with TLS configuration for mTLS
  private createFetchOptions(endpoint: Endpoint): BunFetchOptions {
    const options: BunFetchOptions = {
      method: endpoint.http_method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Monitor/1.0)',
        ...this.parseHeaders(endpoint.http_headers)
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    };

    // Add body for non-GET/HEAD requests
    if (endpoint.http_body && options.method !== 'GET' && options.method !== 'HEAD') {
      options.body = endpoint.http_body;
    }

    // Configure mTLS if enabled
    if (endpoint.client_cert_enabled && endpoint.client_cert_private_key && endpoint.client_cert_public_key) {
      options.tls = {
        cert: endpoint.client_cert_public_key,
        key: endpoint.client_cert_private_key,
        rejectUnauthorized: false, // Start with permissive settings
      };

      // Add CA certificate if provided and enable verification
      if (endpoint.client_cert_ca) {
        options.tls.ca = endpoint.client_cert_ca;
        options.tls.rejectUnauthorized = true;
      }

      // Set server name for SNI
      try {
        const url = new URL(endpoint.url);
        options.tls.serverName = url.hostname;
      } catch (error) {
        this.logger.warn(`Invalid URL for SNI configuration: ${endpoint.url}`, 'MONITORING');
      }
    }

    return options;
  }

  // Parse HTTP headers from JSON string
  private parseHeaders(headersJson?: string | null): Record<string, string> {
    if (!headersJson) return {};
    
    try {
      return JSON.parse(headersJson);
    } catch (error) {
      this.logger.warn(`Invalid HTTP headers JSON: ${headersJson}`, 'MONITORING');
      return {};
    }
  }

  // Parse OK HTTP statuses from JSON string
  private parseOkStatuses(statusesJson?: string | null): string[] {
    if (!statusesJson) return [];
    
    try {
      return JSON.parse(statusesJson);
    } catch (error) {
      this.logger.warn(`Invalid OK HTTP statuses JSON: ${statusesJson}`, 'MONITORING');
      return [];
    }
  }

  // Check if response status is considered OK
  private isStatusOk(status: number, endpoint: Endpoint): boolean {
    const okStatuses = this.parseOkStatuses(endpoint.ok_http_statuses);
    
    if (okStatuses.length > 0) {
      return okStatuses.includes(status.toString());
    }
    
    // Default behavior: 2xx status codes are OK
    return status >= 200 && status < 300;
  }

  // Check if response contains required keyword
  private async checkKeyword(response: Response, keyword?: string | null): Promise<boolean> {
    if (!keyword?.trim()) return true;
    
    try {
      const text = await response.text();
      return text.includes(keyword);
    } catch (error) {
      this.logger.warn(`Error reading response text for keyword search: ${error}`, 'MONITORING');
      return false;
    }
  }

  // Perform HTTP check using Bun's fetch
  private async checkHttp(endpoint: Endpoint): Promise<{ isOk: boolean; responseTime: number }> {
    const startTime = Date.now();
    
    try {
      const options = this.createFetchOptions(endpoint);

      const response = await fetch(endpoint.url, options);
      const responseTime = Date.now() - startTime;

      // Check status code
      const statusOk = this.isStatusOk(response.status, endpoint);
      
      if (!statusOk) {
        await this.logger.debug(`HTTP status check failed for ${endpoint.url}: ${response.status}`, 'MONITORING');
        return { isOk: false, responseTime };
      }

      // Check keyword if specified
      const keywordOk = await this.checkKeyword(response, endpoint.keyword_search);
      
      if (!keywordOk) {
        await this.logger.debug(`Keyword search failed for ${endpoint.url}: "${endpoint.keyword_search}" not found`, 'MONITORING');
        return { isOk: false, responseTime };
      }

      return { isOk: true, responseTime };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      await this.logger.debug(`HTTP request failed for ${endpoint.url}: ${error}`, 'MONITORING');
      return { isOk: false, responseTime };
    }
  }

  // Perform ping check
  private async checkPing(endpoint: Endpoint): Promise<{ isOk: boolean; responseTime: number }> {
    try {
      const result = await ping.promise.probe(endpoint.url, { timeout: 10 });
      const responseTime = result.time === 'unknown' ? 0 : result.time;
      return { isOk: result.alive, responseTime };
    } catch (error) {
      await this.logger.debug(`Ping failed for ${endpoint.url}: ${error}`, 'MONITORING');
      return { isOk: false, responseTime: 0 };
    }
  }

  // Perform TCP port check
  private async checkTcp(endpoint: Endpoint): Promise<{ isOk: boolean; responseTime: number }> {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(10000);
      
      socket.on('connect', () => {
        const responseTime = Date.now() - startTime;
        socket.destroy();
        resolve({ isOk: true, responseTime });
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ isOk: false, responseTime: Date.now() - startTime });
      });
      
      socket.on('error', () => {
        socket.destroy();
        resolve({ isOk: false, responseTime: Date.now() - startTime });
      });
      
      socket.connect(endpoint.tcp_port!, endpoint.url);
    });
  }

  // Perform Kafka check
  private async checkKafka(endpoint: Endpoint): Promise<{ isOk: boolean; responseTime: number }> {
    await this.logger.debug(`[Kafka-${endpoint.name}] Performing health check using persistent connection`, 'KAFKA');
    
    try {
      const healthResult = await this.kafkaService.checkKafkaHealth(endpoint);
      
      if (healthResult.isOk) {
        await this.logger.debug(`[Kafka-${endpoint.name}] Health check passed in ${healthResult.responseTime}ms`, 'KAFKA');
      } else {
        await this.logger.warn(`[Kafka-${endpoint.name}] Health check failed in ${healthResult.responseTime}ms`, 'KAFKA');
      }
      
      return healthResult;
    } catch (error) {
      await this.logger.error(`[Kafka-${endpoint.name}] Health check error: ${error}`, 'KAFKA');
      throw error;
    }
  }

  // Function to check a single endpoint
  async checkSingleEndpoint(endpoint: Endpoint): Promise<void> {
    // Skip if endpoint is paused
    if (endpoint.paused) {
      await this.logger.debug(`Skipping paused endpoint "${endpoint.name}" (ID: ${endpoint.id})`, 'MONITORING');
      return;
    }

    const startTime = Date.now();
    let isOk = false;
    let responseTime = 0;

    try {
      // Perform the appropriate check based on endpoint type
      switch (endpoint.type) {
        case 'http':
          const httpResult = await this.checkHttp(endpoint);
          isOk = httpResult.isOk;
          responseTime = httpResult.responseTime;
          break;

        case 'ping':
          const pingResult = await this.checkPing(endpoint);
          isOk = pingResult.isOk;
          responseTime = pingResult.responseTime;
          break;

        case 'tcp':
          const tcpResult = await this.checkTcp(endpoint);
          isOk = tcpResult.isOk;
          responseTime = tcpResult.responseTime;
          break;

        case 'kafka_producer':
        case 'kafka_consumer':
          const kafkaResult = await this.checkKafka(endpoint);
          isOk = kafkaResult.isOk;
          responseTime = kafkaResult.responseTime;
          break;

        default:
          throw new Error(`Unsupported endpoint type: ${endpoint.type}`);
      }

      // Apply upside down mode if enabled
      if (endpoint.upside_down_mode) {
        isOk = !isOk;
      }

      if (isOk) {
        if (endpoint.status !== 'UP') {
          await this.logger.info(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) recovered - status changed from ${endpoint.status} to UP`, 'MONITORING');
          await this.sendNotification(endpoint, 'UP');
        } else {
          await this.logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) check successful - response time: ${responseTime}ms`, 'MONITORING');
        }
        
        this.db.run('UPDATE endpoints SET status = ?, failed_attempts = 0, last_checked = CURRENT_TIMESTAMP WHERE id = ?', ['UP', endpoint.id]);
        this.db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', [endpoint.id, responseTime, 'UP']);
      } else {
        throw new Error('Check failed');
      }
    } catch (error) {
      responseTime = responseTime || (Date.now() - startTime);
      const newFailedAttempts = (endpoint.failed_attempts || 0) + 1;
      
      if (newFailedAttempts >= (endpoint.retries || 3)) {
        if (endpoint.status !== 'DOWN') {
          await this.logger.error(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) failed after ${newFailedAttempts} attempts - status changed to DOWN. Error: ${error}`, 'MONITORING');
          await this.sendNotification(endpoint, 'DOWN');
        } else {
          await this.logger.warn(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) check failed (attempt ${newFailedAttempts}). Error: ${error}`, 'MONITORING');
        }
        this.db.run('UPDATE endpoints SET status = ?, failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', ['DOWN', newFailedAttempts, endpoint.id]);
      } else {
        await this.logger.warn(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) check failed (attempt ${newFailedAttempts}/${endpoint.retries}). Error: ${error}`, 'MONITORING');
        this.db.run('UPDATE endpoints SET failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', [newFailedAttempts, endpoint.id]);
      }
      this.db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', [endpoint.id, responseTime, 'DOWN']);
    }
  }

  // Function to check certificate expiration for a single endpoint
  async checkCertificateExpiry(endpoint: Endpoint): Promise<void> {
    // Skip if endpoint is paused or certificate checking is disabled
    if (endpoint.paused || !endpoint.check_cert_expiry || endpoint.type !== 'http') {
      return;
    }

    try {
      await this.logger.debug(`Checking certificate expiry for ${endpoint.url}`, 'CERTIFICATE');
      const certResult = await this.certificateService.getCertificateExpiry(endpoint.url);
      
      if (certResult.success) {
        const daysRemaining = certResult.result.daysRemaining;
        const expiryDate = certResult.result.validTo.toISOString();
        
        await this.logger.debug(`Certificate check successful for ${endpoint.url} - expires in ${daysRemaining} days`, 'CERTIFICATE');
        
        // Update certificate information in database
        this.db.run(
          'UPDATE endpoints SET cert_expires_in = ?, cert_expiry_date = ? WHERE id = ?',
          [daysRemaining, expiryDate, endpoint.id]
        );
        
        if (daysRemaining <= (endpoint.cert_expiry_threshold || 30)) {
          await this.logger.warn(`Certificate expiring soon for ${endpoint.url} - ${daysRemaining} days remaining`, 'CERTIFICATE');
          await this.sendNotification(endpoint, `Certificate for ${endpoint.url} is expiring in ${daysRemaining} days.`);
        }
      } else {
        // Log the specific error details for debugging
        await this.logger.warn(`Certificate check failed for ${endpoint.url}: ${certResult.error.error} - ${certResult.error.details}`, 'CERTIFICATE');
        
        // Clear certificate information on failure
        this.db.run(
          'UPDATE endpoints SET cert_expires_in = NULL, cert_expiry_date = NULL WHERE id = ?',
          [endpoint.id]
        );
      }
    } catch (err) {
      await this.logger.error(`Unexpected error during certificate check for ${endpoint.url}: ${err}`, 'CERTIFICATE');
      
      // Clear certificate information on error
      this.db.run(
        'UPDATE endpoints SET cert_expires_in = NULL, cert_expiry_date = NULL WHERE id = ?',
        [endpoint.id]
      );
    }
  }

  // Function to start certificate monitoring for a single endpoint
  startCertificateMonitoring(endpoint: Endpoint): void {
    // Clear existing certificate timer if any
    if (this.certificateTimers.has(endpoint.id)) {
      clearTimeout(this.certificateTimers.get(endpoint.id)!);
    }

    // Don't start certificate monitoring if endpoint is paused, not HTTP, or certificate checking is disabled
    if (endpoint.paused || endpoint.type !== 'http' || !endpoint.check_cert_expiry) {
      return;
    }

    // Bind the checkCertificateExpiry to the current context
    const boundCertCheck = this.checkCertificateExpiry.bind(this);

    const scheduleCertCheck = () => {
      const intervalSeconds = (endpoint.cert_check_interval && endpoint.cert_check_interval > 0) 
        ? endpoint.cert_check_interval 
        : DEFAULT_CERT_CHECK_INTERVAL;

      const timer = setTimeout(async () => {
        try {
          const currentEndpoint = this.db.query('SELECT paused, check_cert_expiry FROM endpoints WHERE id = ?').get(endpoint.id) as any;
          // Convert SQLite integer values to proper booleans
          const isPaused = Boolean(currentEndpoint?.paused);
          const isCertCheckEnabled = Boolean(currentEndpoint?.check_cert_expiry);
          
          if (!isPaused && isCertCheckEnabled) {
            await boundCertCheck(endpoint);
          } else {
            await this.logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) certificate monitoring stopped - endpoint paused: ${isPaused}, cert checking enabled: ${isCertCheckEnabled}`, 'CERTIFICATE');
            this.stopCertificateMonitoring(endpoint.id);
            return;
          }
        } catch (err) {
          await this.logger.error(`Error checking certificate for endpoint ${endpoint.id} (${endpoint.name}): ${err}`, 'CERTIFICATE');
        }
        scheduleCertCheck();
      }, intervalSeconds * 1000);

      this.certificateTimers.set(endpoint.id, timer);
    };

    // Start the first certificate check immediately
    (async () => {
      try {
        const currentEndpoint = this.db.query('SELECT paused, check_cert_expiry FROM endpoints WHERE id = ?').get(endpoint.id) as any;
        // Convert SQLite integer values to proper booleans
        const isPaused = Boolean(currentEndpoint?.paused);
        const isCertCheckEnabled = Boolean(currentEndpoint?.check_cert_expiry);
        
        if (!isPaused && isCertCheckEnabled) {
          await boundCertCheck(endpoint);
          await this.logger.info(`Started certificate monitoring for "${endpoint.name}" (ID: ${endpoint.id}) with ${(endpoint.cert_check_interval || DEFAULT_CERT_CHECK_INTERVAL) / 3600}h interval`, 'CERTIFICATE');
        } else {
          await this.logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) certificate monitoring not started - endpoint paused: ${isPaused}, cert checking enabled: ${isCertCheckEnabled}`, 'CERTIFICATE');
          return;
        }
      } catch (err) {
        await this.logger.error(`Error in initial certificate check for endpoint ${endpoint.id} (${endpoint.name}): ${err}`, 'CERTIFICATE');
      }
      scheduleCertCheck();
    })();
  }

  // Function to stop certificate monitoring for an endpoint
  stopCertificateMonitoring(endpointId: number): void {
    if (this.certificateTimers.has(endpointId)) {
      clearTimeout(this.certificateTimers.get(endpointId)!);
      this.certificateTimers.delete(endpointId);
      this.logger.debug(`Stopped certificate monitoring for endpoint ID: ${endpointId}`, 'CERTIFICATE');
    }
  }

  // Function to start monitoring for a single endpoint
  startEndpointMonitoring(endpoint: Endpoint): void {
    // Clear existing timer if any
    if (this.endpointTimers.has(endpoint.id)) {
      clearTimeout(this.endpointTimers.get(endpoint.id)!);
    }

    // Don't start monitoring if endpoint is paused
    if (endpoint.paused) {
      this.logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) is paused - skipping monitoring`, 'MONITORING');
      return;
    }

    // Bind the checkSingleEndpoint to the current context
    const boundCheck = this.checkSingleEndpoint.bind(this);

    const scheduleCheck = () => {
      const intervalSeconds = (endpoint.heartbeat_interval && endpoint.heartbeat_interval > 0) ? endpoint.heartbeat_interval : 60;

      const timer = setTimeout(async () => {
        try {
          const currentEndpoint = this.db.query('SELECT paused FROM endpoints WHERE id = ?').get(endpoint.id) as any;
          if (!currentEndpoint?.paused) {
            await boundCheck(endpoint);
          } else {
            await this.logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) was paused - stopping monitoring`, 'MONITORING');
            this.stopEndpointMonitoring(endpoint.id);
            return;
          }
        } catch (err) {
          await this.logger.error(`Error checking endpoint ${endpoint.id} (${endpoint.name}): ${err}`, 'MONITORING');
        }
        scheduleCheck();
      }, intervalSeconds * 1000);

      this.endpointTimers.set(endpoint.id, timer);
    };

    // Start the first check immediately
    (async () => {
      try {
        const currentEndpoint = this.db.query('SELECT paused FROM endpoints WHERE id = ?').get(endpoint.id) as any;
        if (!currentEndpoint?.paused) {
          await boundCheck(endpoint);
        } else {
          await this.logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) was paused - not starting monitoring`, 'MONITORING');
          return;
        }
      } catch (err) {
        await this.logger.error(`Error in initial check for endpoint ${endpoint.id} (${endpoint.name}): ${err}`, 'MONITORING');
      }
      scheduleCheck();
    })();
  }

  // Function to stop monitoring for an endpoint
  stopEndpointMonitoring(endpointId: number): void {
    if (this.endpointTimers.has(endpointId)) {
      clearTimeout(this.endpointTimers.get(endpointId)!);
      this.endpointTimers.delete(endpointId);
      this.logger.debug(`Stopped monitoring for endpoint ID: ${endpointId}`, 'MONITORING');
    }
    
    // Also stop certificate monitoring
    this.stopCertificateMonitoring(endpointId);
    
    // Cleanup any Kafka connections for this endpoint
    this.kafkaService.cleanupKafkaConnection(endpointId);
  }

  // Function to restart monitoring for a specific endpoint (hot-reload)
  restartEndpointMonitoring(endpointId: number): void {
    // Stop existing monitoring
    this.stopEndpointMonitoring(endpointId);
    
    // Get updated endpoint configuration from database
    const updatedEndpoint = this.db.query('SELECT * FROM endpoints WHERE id = ?').get(endpointId) as Endpoint | null;
    
    if (updatedEndpoint) {
      this.logger.info(`Restarting monitoring for updated endpoint "${updatedEndpoint.name}" (ID: ${endpointId})`, 'MONITORING');
      this.startEndpointMonitoring(updatedEndpoint);
      this.startCertificateMonitoring(updatedEndpoint);
    } else {
      this.logger.warn(`Could not restart monitoring for endpoint ID: ${endpointId} - endpoint not found in database`, 'MONITORING');
    }
  }

  // Initialize monitoring for all existing endpoints
  async initializeMonitoring(): Promise<void> {
    try {
      const endpoints: Endpoint[] = this.db.query('SELECT * FROM endpoints').all() as Endpoint[];
      await this.logger.info(`Starting monitoring for ${endpoints.length} endpoints`, 'MONITORING');
      
      for (const endpoint of endpoints) {
        await this.logger.info(`Starting monitor for "${endpoint.name}" (ID: ${endpoint.id}) with ${endpoint.heartbeat_interval || 60}s interval`, 'MONITORING');
        this.startEndpointMonitoring(endpoint);
        this.startCertificateMonitoring(endpoint);
      }
    } catch (err) {
      await this.logger.error(`Error initializing monitoring: ${err}`, 'MONITORING');
    }
  }
}
