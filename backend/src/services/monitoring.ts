import ping from 'ping';
import net from 'net';
import tls from 'tls';
import https from 'https';
import { Database } from 'bun:sqlite';
import type { Endpoint } from '../types';
import { LoggerService } from './logger';
import { KafkaService } from './kafka';

export class MonitoringService {
  // Store active timers for each endpoint
  private endpointTimers = new Map<number, NodeJS.Timeout>();

  constructor(
    private db: Database, 
    private logger: LoggerService, 
    private kafkaService: KafkaService,
    private sendNotification: (endpoint: Endpoint, status: string) => Promise<void>
  ) {}

  // Helper function to create HTTP agent with mTLS support
  private createHttpAgent(endpoint: Endpoint): https.Agent | undefined {
    if (!endpoint.client_cert_enabled || !endpoint.client_cert_private_key || !endpoint.client_cert_public_key) {
      return undefined;
    }

    try {
      const options: any = {
        cert: endpoint.client_cert_public_key,
        key: endpoint.client_cert_private_key,
        rejectUnauthorized: true, // Verify server certificate
      };

      // Add CA certificate if provided
      if (endpoint.client_cert_ca) {
        options.ca = endpoint.client_cert_ca;
      }

      return new https.Agent(options);
    } catch (error) {
      console.error(`Error creating mTLS agent for endpoint ${endpoint.id}: ${error}`);
      return undefined;
    }
  }

  // Function to get SSL certificate expiry
  private async getCertificateExpiry(hostname: string): Promise<{ daysRemaining: number } | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        socket?.destroy();
        resolve(null);
      }, 10000); // 10 second timeout

      let socket: tls.TLSSocket | null = null;
      
      try {
        socket = tls.connect({
          host: hostname,
          port: 443,
          servername: hostname,
          timeout: 8000, // 8 second connection timeout
          rejectUnauthorized: false // Don't reject self-signed or invalid certs, we just want expiry info
        }, () => {
          clearTimeout(timeout);
          
          try {
            const cert = socket?.getPeerCertificate();
            if (cert && cert.valid_to) {
              const validTo = new Date(cert.valid_to);
              const daysRemaining = Math.ceil((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              resolve({ daysRemaining });
            } else {
              resolve(null);
            }
          } catch (err) {
            // Error getting certificate info, just return null
            resolve(null);
          } finally {
            socket?.end();
          }
        });

        socket.on('error', () => {
          // On any TLS/SSL error, just resolve with null
          // This prevents the application from crashing on problematic certificates
          clearTimeout(timeout);
          socket?.destroy();
          resolve(null);
        });

        socket.on('timeout', () => {
          clearTimeout(timeout);
          socket?.destroy();
          resolve(null);
        });
        
      } catch (err) {
        // Any other error during connection setup
        clearTimeout(timeout);
        socket?.destroy();
        resolve(null);
      }
    });
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
      switch (endpoint.type) {
        case 'http':
          if (endpoint.check_cert_expiry) {
            try {
              const hostname = new URL(endpoint.url).hostname;
              const certDetails = await this.getCertificateExpiry(hostname);
              if (certDetails && certDetails.daysRemaining !== undefined) {
                const daysRemaining = certDetails.daysRemaining;
                if (daysRemaining <= endpoint.cert_expiry_threshold!) {
                  await this.sendNotification(endpoint, `Certificate for ${endpoint.url} is expiring in ${daysRemaining} days.`);
                }
              }
            } catch (err) {
              console.info(`Could not check SSL certificate for ${endpoint.url} - this is normal for sites with certificate issues`);
            }
          }
          
          const headers = endpoint.http_headers ? JSON.parse(endpoint.http_headers) : undefined;
          const body = endpoint.http_body;
          const method = endpoint.http_method || 'GET';

          // Create mTLS agent if client certificates are enabled
          const agent = this.createHttpAgent(endpoint);
          
          let response: Response;
          if (agent && endpoint.url.startsWith('https://')) {
            // Use Node.js HTTPS with mTLS for HTTPS URLs when mTLS is enabled
            const url = new URL(endpoint.url);
            const requestOptions = {
              hostname: url.hostname,
              port: url.port || 443,
              path: url.pathname + url.search,
              method,
              headers: headers as any,
              agent,
            };

            response = await new Promise((resolve, reject) => {
              const req = https.request(requestOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                  data += chunk;
                });
                res.on('end', () => {
                  resolve({
                    ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
                    status: res.statusCode || 0,
                    text: async () => data,
                  } as Response);
                });
              });

              req.on('error', reject);

              if (body && (method !== 'GET' && method !== 'HEAD')) {
                req.write(body);
              }
              
              req.end();
            });
          } else {
            // Use standard fetch for non-HTTPS URLs or when mTLS is disabled
            response = await fetch(endpoint.url, {
              method,
              headers,
              body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
            });
          }

          responseTime = Date.now() - startTime;
          const ok_http_statuses = endpoint.ok_http_statuses ? JSON.parse(endpoint.ok_http_statuses) : [];
          isOk = response.ok;
          if (ok_http_statuses.length > 0) {
            isOk = ok_http_statuses.includes(response.status.toString());
          }

          // Check for keyword in response if specified
          if (isOk && endpoint.keyword_search && endpoint.keyword_search.trim()) {
            try {
              const responseText = await response.text();
              const containsKeyword = responseText.includes(endpoint.keyword_search);
              if (!containsKeyword) {
                isOk = false;
              }
            } catch (err) {
              console.error(`Error reading response text for keyword search on ${endpoint.url}:`, err);
              isOk = false;
            }
          }
          break;

        case 'ping':
          const pingRes = await ping.promise.probe(endpoint.url, { timeout: 10 });
          responseTime = pingRes.time === 'unknown' ? 0 : pingRes.time;
          isOk = pingRes.alive;
          break;

        case 'tcp':
          isOk = await new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(10000);
            socket.on('connect', () => {
              responseTime = Date.now() - startTime;
              socket.destroy();
              resolve(true);
            });
            socket.on('timeout', () => {
              socket.destroy();
              resolve(false);
            });
            socket.on('error', () => {
              socket.destroy();
              resolve(false);
            });
            socket.connect(endpoint.tcp_port!, endpoint.url);
          });
          break;

        case 'kafka_producer':
        case 'kafka_consumer':
          await this.logger.debug(`[Kafka-${endpoint.name}] Performing health check using persistent connection`, 'KAFKA');
          
          try {
            const healthResult = await this.kafkaService.checkKafkaHealth(endpoint);
            isOk = healthResult.isOk;
            responseTime = healthResult.responseTime;
            
            if (isOk) {
              await this.logger.debug(`[Kafka-${endpoint.name}] Health check passed in ${responseTime}ms`, 'KAFKA');
            } else {
              await this.logger.warn(`[Kafka-${endpoint.name}] Health check failed in ${responseTime}ms`, 'KAFKA');
            }
          } catch (error) {
            responseTime = Date.now() - startTime;
            await this.logger.error(`[Kafka-${endpoint.name}] Health check error: ${error}`, 'KAFKA');
            throw error;
          }
          break;
      }

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

    const scheduleCheck = () => {
      // Ensure heartbeat_interval is a positive number, default to 60 if invalid
      const intervalSeconds = (endpoint.heartbeat_interval && endpoint.heartbeat_interval > 0) ? endpoint.heartbeat_interval : 60;

      const timer = setTimeout(async () => {
        try {
          // Check if endpoint is still not paused before running check
          const currentEndpoint = this.db.query('SELECT paused FROM endpoints WHERE id = ?').get(endpoint.id) as any;
          if (!currentEndpoint?.paused) {
            await this.checkSingleEndpoint(endpoint);
          } else {
            await this.logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) was paused - stopping monitoring`, 'MONITORING');
            this.stopEndpointMonitoring(endpoint.id);
            return;
          }
        } catch (err) {
          await this.logger.error(`Error checking endpoint ${endpoint.id} (${endpoint.name}): ${err}`, 'MONITORING');
        }
        // Schedule the next check
        scheduleCheck();
      }, intervalSeconds * 1000);

      this.endpointTimers.set(endpoint.id, timer);
    };

    // Start the first check immediately, then schedule subsequent checks
    setTimeout(async () => {
      try {
        const currentEndpoint = this.db.query('SELECT paused FROM endpoints WHERE id = ?').get(endpoint.id) as any;
        if (!currentEndpoint?.paused) {
          await this.checkSingleEndpoint(endpoint);
        } else {
          await this.logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) was paused - not starting monitoring`, 'MONITORING');
          return;
        }
      } catch (err) {
        await this.logger.error(`Error in initial check for endpoint ${endpoint.id} (${endpoint.name}): ${err}`, 'MONITORING');
      }
      // Schedule subsequent checks
      scheduleCheck();
    }, 1000); // Small delay to avoid overwhelming on startup
  }

  // Function to stop monitoring for an endpoint
  stopEndpointMonitoring(endpointId: number): void {
    if (this.endpointTimers.has(endpointId)) {
      clearTimeout(this.endpointTimers.get(endpointId)!);
      this.endpointTimers.delete(endpointId);
      this.logger.debug(`Stopped monitoring for endpoint ID: ${endpointId}`, 'MONITORING');
    }
    
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
      }
    } catch (err) {
      await this.logger.error(`Error initializing monitoring: ${err}`, 'MONITORING');
    }
  }
}
