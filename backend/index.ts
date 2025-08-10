import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import path from 'path';
import { Database } from 'sqlite';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import ping from 'ping';
import net from 'net';
import { spawn } from 'child_process';
import tls from 'tls';
import { Kafka, logLevel } from 'kafkajs';
import https from 'https';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import { Issuer, type Client, generators } from 'openid-client';

type MonitorType = 'http' | 'ping' | 'tcp' | 'kafka_producer' | 'kafka_consumer';

// Authentication types
interface User {
  id: number;
  username: string;
  email?: string;
  password_hash?: string;
  role: 'admin' | 'user';
  oidc_provider_id?: number;
  oidc_subject?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login?: string;
}

interface OIDCProvider {
  id: number;
  name: string;
  issuer_url: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  is_active: boolean;
  created_at: string;
}

interface UserSession {
  id: number;
  user_id: number;
  session_token: string;
  expires_at: string;
  created_at: string;
}

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Database configuration
const DB_PATH = process.env.DB_PATH || './db.sqlite';

// Helper function to create HTTP agent with mTLS support
function createHttpAgent(endpoint: Endpoint): https.Agent | undefined {
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

// Gap-aware uptime calculation function
async function calculateGapAwareUptime(db: Database, endpointId: number, heartbeatInterval: number, period: string) {
  // Get all checks in the time period, ordered by time
  const checks = await db.all(
    `SELECT created_at, status, response_time
     FROM response_times 
     WHERE endpoint_id = ? AND created_at >= datetime('now', '-${period}')
     ORDER BY created_at ASC`,
    endpointId
  );

  if (checks.length === 0) {
    return { avg_response: 0, uptime: 0, monitoring_coverage: 0 };
  }

  // Convert heartbeat interval to milliseconds and add tolerance
  const expectedIntervalMs = heartbeatInterval * 1000;
  const gapThresholdMs = expectedIntervalMs * 2.5; // Allow 2.5x interval as gap threshold
  
  // Group checks into continuous monitoring sessions
  const monitoringSessions: Array<{start: Date, end: Date, checks: any[]}> = [];
  let currentSession = {
    start: new Date(checks[0].created_at),
    end: new Date(checks[0].created_at),
    checks: [checks[0]]
  };

  for (let i = 1; i < checks.length; i++) {
    const currentCheck = checks[i];
    const previousCheck = checks[i - 1];
    
    const timeDiff = new Date(currentCheck.created_at).getTime() - new Date(previousCheck.created_at).getTime();
    
    if (timeDiff <= gapThresholdMs) {
      // Continue current session
      currentSession.end = new Date(currentCheck.created_at);
      currentSession.checks.push(currentCheck);
    } else {
      // Gap detected - end current session and start new one
      monitoringSessions.push(currentSession);
      currentSession = {
        start: new Date(currentCheck.created_at),
        end: new Date(currentCheck.created_at),
        checks: [currentCheck]
      };
    }
  }
  
  // Add the last session
  monitoringSessions.push(currentSession);

  // Calculate total monitored time and uptime using improved logic
  let totalMonitoredTimeMs = 0;
  let totalUptimeMs = 0;
  let totalResponseTime = 0;
  let totalChecks = 0;

  for (const session of monitoringSessions) {
    // Calculate session duration more accurately
    // If session has only one check, use the heartbeat interval as duration
    // Otherwise, use actual time span plus one interval to account for the last check
    let sessionDurationMs;
    if (session.checks.length === 1) {
      sessionDurationMs = expectedIntervalMs;
    } else {
      const sessionSpan = session.end.getTime() - session.start.getTime();
      sessionDurationMs = sessionSpan + expectedIntervalMs; // Add one interval for the last check
    }
    
    totalMonitoredTimeMs += sessionDurationMs;
    
    // Calculate uptime for this session based on UP/DOWN status of checks
    // Each check represents the status for one heartbeat interval
    let upChecks = 0;
    let totalSessionChecks = 0;
    
    for (const check of session.checks) {
      totalResponseTime += check.response_time || 0;
      totalChecks++;
      totalSessionChecks++;
      
      if (check.status === 'UP') {
        upChecks++;
      }
    }
    
    // Calculate session uptime: (UP checks / total checks) * session duration
    const sessionUptimeRatio = totalSessionChecks > 0 ? upChecks / totalSessionChecks : 0;
    const sessionUptimeMs = sessionDurationMs * sessionUptimeRatio;
    
    totalUptimeMs += sessionUptimeMs;
  }

  // Calculate final metrics
  const uptime = totalMonitoredTimeMs > 0 ? (totalUptimeMs / totalMonitoredTimeMs) * 100 : 0;
  const avgResponse = totalChecks > 0 ? totalResponseTime / totalChecks : 0;
  
  // Calculate monitoring coverage (how much of the period was actually monitored)
  const periodToMs: { [key: string]: number } = {
    '3 hours': 3 * 60 * 60 * 1000,
    '6 hours': 6 * 60 * 60 * 1000,
    '1 day': 24 * 60 * 60 * 1000,
    '7 days': 7 * 24 * 60 * 60 * 1000,
    '30 days': 30 * 24 * 60 * 60 * 1000,
    '365 days': 365 * 24 * 60 * 60 * 1000
  };
  const periodMs = periodToMs[period] || 24 * 60 * 60 * 1000; // Default to 1 day
  const monitoringCoverage = Math.min(100, (totalMonitoredTimeMs / periodMs) * 100);

  return {
    avg_response: avgResponse,
    uptime: Math.max(0, Math.min(100, uptime)), // Clamp between 0-100
    monitoring_coverage: Math.max(0, Math.min(100, monitoringCoverage))
  };
}

interface Endpoint {
  id: number;
  name: string;
  type: MonitorType;
  url: string; // For HTTP, it's the URL; for Ping/TCP, the host; for Kafka, the bootstrap server
  status: string;
  last_checked: string | null;
  heartbeat_interval: number;
  retries: number;
  failed_attempts: number;
  upside_down_mode: boolean;
  paused: boolean;

  // HTTP specific
  http_method?: string;
  http_headers?: string | null;
  http_body?: string | null;
  ok_http_statuses?: string | null;
  check_cert_expiry?: boolean;
  cert_expiry_threshold?: number;
  keyword_search?: string | null;

  // mTLS (Client Certificates) - for HTTP and Kafka
  client_cert_enabled?: boolean;
  client_cert_public_key?: string | null; // PEM format
  client_cert_private_key?: string | null; // PEM format
  client_cert_ca?: string | null; // PEM format

  // TCP specific
  tcp_port?: number;

  // Kafka specific
  kafka_topic?: string;
  kafka_message?: string; // For producer
  kafka_config?: string; // For consumer/producer specific configs
}

async function main() {
  const db: Database = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  // Logging utility
  let currentLogLevel = 'info';
  const logLevels = { debug: 0, info: 1, warn: 2, error: 3 };

  async function log(level: string, message: string, component?: string) {
    // Only log if the level meets the current threshold
    if (logLevels[level as keyof typeof logLevels] >= logLevels[currentLogLevel as keyof typeof logLevels]) {
      // Log to console
      console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${component ? `[${component}] ` : ''}${message}`);
      
      // Log to database (with error handling to avoid infinite loops)
      try {
        await db.run(
          'INSERT INTO application_logs (level, message, component) VALUES (?, ?, ?)',
          level, message, component || null
        );
      } catch (err) {
        console.error('Failed to write log to database:', err);
      }
    }
  }

  const logger = {
    debug: (message: string, component?: string) => log('debug', message, component),
    info: (message: string, component?: string) => log('info', message, component),
    warn: (message: string, component?: string) => log('warn', message, component),
    error: (message: string, component?: string) => log('error', message, component),
  };

  logger.info('Starting Endpoint Monitor application', 'SYSTEM');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT NOT NULL DEFAULT 'http',
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      last_checked DATETIME,
      heartbeat_interval INTEGER DEFAULT 60,
      retries INTEGER DEFAULT 3,
      failed_attempts INTEGER DEFAULT 0,
      upside_down_mode BOOLEAN DEFAULT false,
      paused BOOLEAN DEFAULT false,
      
      -- HTTP specific
      http_method TEXT DEFAULT 'GET',
      http_headers TEXT,
      http_body TEXT,
      ok_http_statuses TEXT,
      check_cert_expiry BOOLEAN DEFAULT false,
      cert_expiry_threshold INTEGER DEFAULT 30,
      keyword_search TEXT,

      -- mTLS (Client Certificates) - for HTTP and Kafka
      client_cert_enabled BOOLEAN DEFAULT false,
      client_cert_public_key TEXT,
      client_cert_private_key TEXT,
      client_cert_ca TEXT,

      -- TCP specific
      tcp_port INTEGER,

      -- Kafka specific
      kafka_topic TEXT,
      kafka_message TEXT,
      kafka_config TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS notification_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS monitor_notification_services (
      monitor_id INTEGER,
      notification_service_id INTEGER,
      PRIMARY KEY (monitor_id, notification_service_id),
      FOREIGN KEY(monitor_id) REFERENCES endpoints(id) ON DELETE CASCADE,
      FOREIGN KEY(notification_service_id) REFERENCES notification_services(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS response_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER,
      response_time INTEGER,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(endpoint_id) REFERENCES endpoints(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS application_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      component TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS status_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      is_public BOOLEAN DEFAULT true,
      monitor_ids TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Authentication tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      oidc_provider_id INTEGER,
      oidc_subject TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      FOREIGN KEY(oidc_provider_id) REFERENCES oidc_providers(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS oidc_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      issuer_url TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      scopes TEXT DEFAULT 'openid profile email',
      is_active BOOLEAN DEFAULT true,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);


  // Authentication utilities
  const hashPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, 12);
  };

  const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
    return await bcrypt.compare(password, hash);
  };

  const generateToken = (user: User): string => {
    return jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role,
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
  };

  const verifyToken = (token: string): any => {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return null;
    }
  };

  // Authentication middleware
  const authenticateUser = async (request: Request): Promise<User | null> => {
    // Try to get token from Authorization header
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    // If no token in header, try cookies
    if (!token) {
      const cookieHeader = request.headers.get('cookie');
      if (cookieHeader) {
        const cookies = parseCookie(cookieHeader);
        token = cookies.auth_token || null;
      }
    }

    if (!token) {
      return null;
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return null;
    }

    // Get user from database to ensure they still exist and are active
    const user = await db.get(
      'SELECT * FROM users WHERE id = ? AND is_active = 1',
      decoded.id
    );

    return user as User | null;
  };

  const requireAuth = (handler: any) => {
    return async (context: any) => {
      const user = await authenticateUser(context.request);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      context.user = user;
      return handler(context);
    };
  };

  const requireRole = (role: 'admin' | 'user') => {
    return (handler: any) => {
      return async (context: any) => {
        const user = await authenticateUser(context.request);
        if (!user) {
          return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (user.role !== role && role === 'admin') {
          return new Response(JSON.stringify({ error: 'Admin access required' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        context.user = user;
        return handler(context);
      };
    };
  };

  // Create default admin user if no users exist
  const createDefaultAdminUser = async () => {
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    if (userCount.count === 0) {
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
      const hashedPassword = await hashPassword(defaultPassword);
      
      await db.run(
        'INSERT INTO users (username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)',
        'admin',
        'admin@localhost',
        hashedPassword,
        'admin',
        true
      );
      
      logger.info('Created default admin user (username: admin, password: ' + defaultPassword + ')', 'AUTH');
      console.log('\n🔐 Default admin user created:');
      console.log('   Username: admin');
      console.log('   Password: ' + defaultPassword);
      console.log('   Please change this password after first login!\n');
    }
  };

  // Initialize default admin user
  await createDefaultAdminUser();

  // OIDC helper functions
  const oidcClients = new Map<number, Client>();
  const oidcStates = new Map<string, { provider_id: number, expires_at: number, code_verifier?: string }>();

  const getOIDCClient = async (providerId: number): Promise<Client | null> => {
    // Check if we already have a cached client
    if (oidcClients.has(providerId)) {
      return oidcClients.get(providerId)!;
    }

    // Get provider from database
    const provider = await db.get('SELECT * FROM oidc_providers WHERE id = ? AND is_active = 1', providerId);
    if (!provider) {
      return null;
    }

    try {
      // Discover the issuer
      const issuer = await Issuer.discover(provider.issuer_url);
      
      // Create client
      const client = new issuer.Client({
        client_id: provider.client_id,
        client_secret: provider.client_secret,
        redirect_uris: [`http://localhost:3001/api/auth/oidc/callback/${providerId}`],
        response_types: ['code'],
      });

      // Cache the client
      oidcClients.set(providerId, client);
      
      return client;
    } catch (error) {
      logger.error(`Failed to create OIDC client for provider ${providerId}: ${error}`, 'OIDC');
      return null;
    }
  };

  const cleanupExpiredStates = () => {
    const now = Date.now();
    for (const [state, data] of oidcStates.entries()) {
      if (data.expires_at < now) {
        oidcStates.delete(state);
      }
    }
  };

  // Clean up expired states every 5 minutes
  setInterval(cleanupExpiredStates, 5 * 60 * 1000);

  const sendNotification = async (endpoint: Endpoint, status: string) => {
    const services = await db.all(
      `SELECT ns.* FROM notification_services ns
       JOIN monitor_notification_services mns ON ns.id = mns.notification_service_id
       WHERE mns.monitor_id = ?`,
      endpoint.id
    );

    for (const service of services) {
      const config = JSON.parse(service.config);
      const message = `Monitor "${endpoint.name}" (${endpoint.url}) is now ${status}.`;

      try {
        if (service.type === 'telegram') {
          await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: config.chatId,
              text: message,
            }),
          });
        } else if (service.type === 'sendgrid') {
          await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: config.toEmail }] }],
              from: { email: config.fromEmail },
              subject: `Monitor Status: ${endpoint.name} is ${status}`,
              content: [{ type: 'text/plain', value: message }],
            }),
          });
        } else if (service.type === 'slack') {
          await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message }),
          });
        } else if (service.type === 'apprise') {
          const notificationUrls = config.notificationUrls?.split('\n').filter((url: string) => url.trim());
          
          if (config.serverUrl && notificationUrls && notificationUrls.length > 0) {
            // Use Apprise API server
            await fetch(`${config.serverUrl}/notify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                urls: notificationUrls,
                title: `Monitor Status: ${endpoint.name}`,
                body: message,
                type: status === 'DOWN' ? 'failure' : 'success',
              }),
            });
          }
        }
      } catch (error) {
        console.error(`Failed to send notification for endpoint ${endpoint.id} via ${service.name}:`, error);
      }
    }
  };

  const checkEndpoints = async () => {
    const endpoints: Endpoint[] = await db.all('SELECT * FROM endpoints');
    for (const endpoint of endpoints) {
      const startTime = Date.now();
      let isOk = false;
      let responseTime = 0;

      try {
        switch (endpoint.type) {
          case 'http':
            if (endpoint.check_cert_expiry) {
            try {
              const hostname = new URL(endpoint.url).hostname;
              const certDetails = await getCertificateExpiry(hostname);
              if (certDetails && certDetails.daysRemaining !== undefined) {
                const daysRemaining = certDetails.daysRemaining;
                if (daysRemaining <= endpoint.cert_expiry_threshold!) {
                  sendNotification(endpoint, `Certificate for ${endpoint.url} is expiring in ${daysRemaining} days.`);
                }
              }
            } catch (err) {
              // Certificate checking failed, but this should not affect endpoint monitoring
              // Just log as info since this is not critical for the main monitoring functionality
              console.info(`Could not check SSL certificate for ${endpoint.url} - this is normal for sites with certificate issues`);
            }
            }
          const headers = endpoint.http_headers ? JSON.parse(endpoint.http_headers) : undefined;
          const body = endpoint.http_body;
          const method = endpoint.http_method || 'GET';

          // Create mTLS agent if client certificates are enabled
          const agent = createHttpAgent(endpoint);
          
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
          const kafkaConfig = endpoint.kafka_config ? JSON.parse(endpoint.kafka_config) : {};
          
          // Add mTLS configuration to Kafka if client certificates are enabled
          const kafkaOptions: any = {
            clientId: 'monitor-app',
            brokers: [endpoint.url],
            logLevel: logLevel.ERROR,
            ...kafkaConfig,
          };

          if (endpoint.client_cert_enabled && endpoint.client_cert_private_key && endpoint.client_cert_public_key) {
            kafkaOptions.ssl = {
              cert: endpoint.client_cert_public_key,
              key: endpoint.client_cert_private_key,
              rejectUnauthorized: true,
            };

            // Add CA certificate if provided
            if (endpoint.client_cert_ca) {
              kafkaOptions.ssl.ca = endpoint.client_cert_ca;
            }
          }

          const kafka = new Kafka(kafkaOptions);
            if (endpoint.type === 'kafka_producer') {
              const producer = kafka.producer();
              await producer.connect();
              await producer.send({
                topic: endpoint.kafka_topic!,
                messages: [{ value: endpoint.kafka_message || 'test message' }],
              });
              await producer.disconnect();
              isOk = true;
            } else { // kafka_consumer
              const consumer = kafka.consumer({ groupId: `monitor-app-consumer-${endpoint.id}` });
              await consumer.connect();
              await consumer.subscribe({ topic: endpoint.kafka_topic!, fromBeginning: true });
              isOk = await new Promise(async (resolve) => {
                consumer.run({
                  eachMessage: async () => {
                    resolve(true);
                    await consumer.disconnect();
                  },
                });
                // Timeout if no message is received
                setTimeout(async () => {
                  resolve(false);
                  await consumer.disconnect();
                }, 10000);
              });
            }
            responseTime = Date.now() - startTime;
            break;
        }

        if (endpoint.upside_down_mode) {
          isOk = !isOk;
        }

      if (isOk) {
        if (endpoint.status !== 'UP') {
          logger.info(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) recovered - status changed from ${endpoint.status} to UP`, 'MONITORING');
          sendNotification(endpoint, 'UP');
        } else {
          logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) check successful - response time: ${responseTime}ms`, 'MONITORING');
        }
        await db.run('UPDATE endpoints SET status = ?, failed_attempts = 0, last_checked = CURRENT_TIMESTAMP WHERE id = ?', 'UP', endpoint.id);
        await db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', endpoint.id, responseTime, 'UP');
      } else {
        throw new Error('Check failed');
      }
    } catch (error) {
      responseTime = responseTime || (Date.now() - startTime);
      const newFailedAttempts = (endpoint.failed_attempts || 0) + 1;
      
      if (newFailedAttempts >= (endpoint.retries || 3)) {
        if (endpoint.status !== 'DOWN') {
          logger.error(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) failed after ${newFailedAttempts} attempts - status changed to DOWN. Error: ${error}`, 'MONITORING');
          sendNotification(endpoint, 'DOWN');
        } else {
          logger.warn(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) check failed (attempt ${newFailedAttempts}). Error: ${error}`, 'MONITORING');
        }
        await db.run('UPDATE endpoints SET status = ?, failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', 'DOWN', newFailedAttempts, endpoint.id);
      } else {
        logger.warn(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) check failed (attempt ${newFailedAttempts}/${endpoint.retries}). Error: ${error}`, 'MONITORING');
        await db.run('UPDATE endpoints SET failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', newFailedAttempts, endpoint.id);
      }
      await db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', endpoint.id, responseTime, 'DOWN');
    }
    }
  };

  const app = new Elysia()
    .use(cors())
    // Authentication API
    .post('/api/auth/login', async ({ body, set }) => {
      const { username, password } = body as { username: string; password: string };

      if (!username || !password) {
        set.status = 400;
        return { error: 'Username and password are required' };
      }

      // Get user from database
      const user = await db.get(
        'SELECT * FROM users WHERE username = ? AND is_active = 1',
        username
      );

      if (!user || !user.password_hash) {
        set.status = 401;
        return { error: 'Invalid credentials' };
      }

      // Verify password
      const passwordValid = await verifyPassword(password, user.password_hash);
      if (!passwordValid) {
        set.status = 401;
        return { error: 'Invalid credentials' };
      }

      // Update last login
      await db.run(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        user.id
      );

      // Generate JWT token
      const token = generateToken(user);

      // Set HTTP-only cookie for web clients
      const cookieValue = serializeCookie('auth_token', token, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days
        path: '/'
      });

      set.headers['Set-Cookie'] = cookieValue;

      logger.info(`User "${username}" logged in successfully`, 'AUTH');

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          created_at: user.created_at
        },
        token
      };
    })
    .post('/api/auth/logout', async ({ set }) => {
      // Clear the auth cookie
      const cookieValue = serializeCookie('auth_token', '', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 0,
        path: '/'
      });

      set.headers['Set-Cookie'] = cookieValue;

      return { success: true };
    })
    .get('/api/auth/me', requireAuth(async ({ user }: any) => {
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        last_login: user.last_login
      };
    }))
    // OIDC Authentication API
    .get('/api/auth/oidc/providers', async () => {
      const providers = await db.all(
        'SELECT id, name, issuer_url FROM oidc_providers WHERE is_active = 1 ORDER BY name'
      );
      return providers;
    })
    .get('/api/auth/oidc/login/:providerId', async ({ params, set }) => {
      const { providerId } = params;
      
      const client = await getOIDCClient(parseInt(providerId));
      if (!client) {
        set.status = 404;
        return { error: 'OIDC provider not found or inactive' };
      }

      // Generate state and code verifier for PKCE
      const state = generators.state();
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);

      // Store state and code verifier with expiration (10 minutes)
      oidcStates.set(state, {
        provider_id: parseInt(providerId),
        expires_at: Date.now() + 10 * 60 * 1000,
        code_verifier: codeVerifier
      });

      // Get provider scopes
      const provider = await db.get('SELECT scopes FROM oidc_providers WHERE id = ?', providerId);
      const scopes = provider?.scopes || 'openid profile email';

      // Generate authorization URL
      const authUrl = client.authorizationUrl({
        scope: scopes,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      logger.info(`OIDC login initiated for provider ${providerId}`, 'OIDC');

      return { authorization_url: authUrl };
    })
    .get('/api/auth/oidc/callback/:providerId', async ({ params, query, set }) => {
      const { providerId } = params;
      const { code, state, error, error_description } = query as any;

      if (error) {
        logger.error(`OIDC callback error for provider ${providerId}: ${error} - ${error_description}`, 'OIDC');
        set.status = 400;
        return { error: `OIDC authentication failed: ${error_description || error}` };
      }

      if (!code || !state) {
        set.status = 400;
        return { error: 'Missing authorization code or state parameter' };
      }

      // Verify state
      const stateData = oidcStates.get(state);
      if (!stateData || stateData.provider_id !== parseInt(providerId)) {
        set.status = 400;
        return { error: 'Invalid or expired state parameter' };
      }

      // Remove used state
      oidcStates.delete(state);

      if (stateData.expires_at < Date.now()) {
        set.status = 400;
        return { error: 'State parameter has expired' };
      }

      const client = await getOIDCClient(parseInt(providerId));
      if (!client) {
        set.status = 404;
        return { error: 'OIDC provider not found or inactive' };
      }

      try {
        // Exchange authorization code for tokens
        const tokenSet = await client.callback(
          `http://localhost:3001/api/auth/oidc/callback/${providerId}`,
          { code, state },
          { 
            code_verifier: (stateData as any).code_verifier,
            state 
          }
        );

        // Get user info from the ID token and/or userinfo endpoint
        const claims = tokenSet.claims();
        let userInfo = claims;

        // If we have an access token, try to get additional user info
        if (tokenSet.access_token) {
          try {
            const additionalUserInfo = await client.userinfo(tokenSet.access_token);
            userInfo = { ...claims, ...additionalUserInfo };
          } catch (err) {
            logger.warn(`Failed to fetch additional user info for provider ${providerId}: ${err}`, 'OIDC');
          }
        }

        const subject = userInfo.sub;
        const email = userInfo.email;
        const username = userInfo.preferred_username || userInfo.name || email || subject;

        if (!subject) {
          set.status = 400;
          return { error: 'No subject (sub) claim found in OIDC response' };
        }

        // Check if user already exists
        let user = await db.get(
          'SELECT * FROM users WHERE oidc_provider_id = ? AND oidc_subject = ? AND is_active = 1',
          providerId,
          subject
        );

        if (!user) {
          // Check if user exists with same email
          if (email) {
            const existingEmailUser = await db.get(
              'SELECT * FROM users WHERE email = ? AND is_active = 1',
              email
            );
            
            if (existingEmailUser) {
              // Link existing user to OIDC provider
              await db.run(
                'UPDATE users SET oidc_provider_id = ?, oidc_subject = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                providerId,
                subject,
                existingEmailUser.id
              );
              user = existingEmailUser;
              logger.info(`Linked existing user "${existingEmailUser.username}" to OIDC provider ${providerId}`, 'OIDC');
            }
          }

          if (!user) {
            // Create new user
            const result = await db.run(
              'INSERT INTO users (username, email, oidc_provider_id, oidc_subject, role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
              username,
              email || null,
              providerId,
              subject,
              'user', // Default role for OIDC users
              true
            );

            user = await db.get('SELECT * FROM users WHERE id = ?', result.lastID);
            logger.info(`Created new OIDC user "${username}" for provider ${providerId}`, 'OIDC');
          }
        }

        // Update last login
        await db.run(
          'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
          user.id
        );

        // Generate JWT token
        const token = generateToken(user);

        // Set HTTP-only cookie for web clients
        const cookieValue = serializeCookie('auth_token', token, {
          httpOnly: true,
          secure: false, // Set to true in production with HTTPS
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60, // 7 days
          path: '/'
        });

        set.headers['Set-Cookie'] = cookieValue;

        logger.info(`User "${user.username}" logged in successfully via OIDC provider ${providerId}`, 'OIDC');

        // Redirect to frontend
        set.status = 302;
        set.headers['Location'] = '/?oidc_login=success';
        return new Response(null, { 
          status: 302, 
          headers: {
            'Location': '/?oidc_login=success',
            'Set-Cookie': cookieValue
          }
        });
      } catch (error) {
        logger.error(`OIDC token exchange failed for provider ${providerId}: ${error}`, 'OIDC');
        set.status = 400;
        return { error: 'Failed to exchange authorization code for tokens' };
      }
    })
    // OIDC Provider Management API (admin only)
    .get('/api/admin/oidc-providers', requireRole('admin')(async () => {
      const providers = await db.all(
        'SELECT * FROM oidc_providers ORDER BY created_at DESC'
      );
      return providers.map(provider => ({
        ...provider,
        is_active: Boolean(provider.is_active)
      }));
    }))
    .post('/api/admin/oidc-providers', requireRole('admin')(async ({ body }: any) => {
      const { name, issuer_url, client_id, client_secret, scopes } = body as {
        name: string;
        issuer_url: string;
        client_id: string;
        client_secret: string;
        scopes?: string;
      };

      if (!name || !issuer_url || !client_id || !client_secret) {
        return new Response(JSON.stringify({ error: 'Name, issuer URL, client ID, and client secret are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Validate issuer URL by attempting to discover it
      try {
        await Issuer.discover(issuer_url);
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid issuer URL or unable to discover OIDC configuration' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await db.run(
        'INSERT INTO oidc_providers (name, issuer_url, client_id, client_secret, scopes, is_active) VALUES (?, ?, ?, ?, ?, ?)',
        name,
        issuer_url,
        client_id,
        client_secret,
        scopes || 'openid profile email',
        true
      );

      const newProvider = await db.get('SELECT * FROM oidc_providers WHERE id = ?', result.lastID);
      
      logger.info(`Admin created OIDC provider "${name}"`, 'OIDC');

      return {
        ...newProvider,
        is_active: Boolean(newProvider.is_active)
      };
    }))
    .put('/api/admin/oidc-providers/:id', requireRole('admin')(async ({ params, body }: any) => {
      const { id } = params;
      const { name, issuer_url, client_id, client_secret, scopes, is_active } = body as {
        name?: string;
        issuer_url?: string;
        client_id?: string;
        client_secret?: string;
        scopes?: string;
        is_active?: boolean;
      };

      // Get current provider
      const currentProvider = await db.get('SELECT * FROM oidc_providers WHERE id = ?', id);
      if (!currentProvider) {
        return new Response(JSON.stringify({ error: 'OIDC provider not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Validate issuer URL if provided
      if (issuer_url) {
        try {
          await Issuer.discover(issuer_url);
        } catch (error) {
          return new Response(JSON.stringify({ error: 'Invalid issuer URL or unable to discover OIDC configuration' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Prepare update fields
      const updates: any = {};
      const values: any[] = [];
      
      if (name !== undefined) {
        updates.name = name;
        values.push(name);
      }
      if (issuer_url !== undefined) {
        updates.issuer_url = issuer_url;
        values.push(issuer_url);
      }
      if (client_id !== undefined) {
        updates.client_id = client_id;
        values.push(client_id);
      }
      if (client_secret !== undefined) {
        updates.client_secret = client_secret;
        values.push(client_secret);
      }
      if (scopes !== undefined) {
        updates.scopes = scopes;
        values.push(scopes);
      }
      if (is_active !== undefined) {
        updates.is_active = is_active;
        values.push(is_active);
      }

      if (Object.keys(updates).length === 0) {
        return new Response(JSON.stringify({ error: 'No fields to update' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Build SQL
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      values.push(id);

      await db.run(
        `UPDATE oidc_providers SET ${setClause} WHERE id = ?`,
        ...values
      );

      // Clear cached client if configuration changed
      if (issuer_url !== undefined || client_id !== undefined || client_secret !== undefined) {
        oidcClients.delete(parseInt(id));
      }

      const updatedProvider = await db.get('SELECT * FROM oidc_providers WHERE id = ?', id);

      logger.info(`Admin updated OIDC provider "${currentProvider.name}" (ID: ${id})`, 'OIDC');

      return {
        ...updatedProvider,
        is_active: Boolean(updatedProvider.is_active)
      };
    }))
    .delete('/api/admin/oidc-providers/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;

      // Get provider before deletion
      const provider = await db.get('SELECT name FROM oidc_providers WHERE id = ?', id);
      if (!provider) {
        return new Response(JSON.stringify({ error: 'OIDC provider not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if any users are linked to this provider
      const linkedUsers = await db.get(
        'SELECT COUNT(*) as count FROM users WHERE oidc_provider_id = ?',
        id
      );

      if (linkedUsers.count > 0) {
        return new Response(JSON.stringify({ 
          error: `Cannot delete OIDC provider "${provider.name}" as ${linkedUsers.count} user(s) are linked to it` 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      await db.run('DELETE FROM oidc_providers WHERE id = ?', id);

      // Clear cached client
      oidcClients.delete(parseInt(id));

      logger.info(`Admin deleted OIDC provider "${provider.name}" (ID: ${id})`, 'OIDC');

      return { success: true };
    }))
    // User management API (admin only)
    .get('/api/admin/users', requireRole('admin')(async () => {
      const users = await db.all(
        'SELECT id, username, email, role, is_active, created_at, updated_at, last_login FROM users ORDER BY created_at DESC'
      );
      return users;
    }))
    .post('/api/admin/users', requireRole('admin')(async ({ body }: any) => {
      const { username, email, password, role } = body as {
        username: string;
        email?: string;
        password: string;
        role: 'admin' | 'user';
      };

      if (!username || !password) {
        return new Response(JSON.stringify({ error: 'Username and password are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if username already exists
      const existingUser = await db.get('SELECT id FROM users WHERE username = ?', username);
      if (existingUser) {
        return new Response(JSON.stringify({ error: 'Username already exists' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Hash password
      const hashedPassword = await hashPassword(password);

      // Create user
      const result = await db.run(
        'INSERT INTO users (username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)',
        username,
        email || null,
        hashedPassword,
        role || 'user',
        true
      );

      const newUser = await db.get(
        'SELECT id, username, email, role, is_active, created_at FROM users WHERE id = ?',
        result.lastID
      );

      logger.info(`Admin created new user "${username}" with role "${role}"`, 'AUTH');

      return newUser;
    }))
    .put('/api/admin/users/:id', requireRole('admin')(async ({ params, body }: any) => {
      const { id } = params;
      const { username, email, role, is_active, password } = body as {
        username?: string;
        email?: string;
        role?: 'admin' | 'user';
        is_active?: boolean;
        password?: string;
      };

      // Get current user
      const currentUser = await db.get('SELECT * FROM users WHERE id = ?', id);
      if (!currentUser) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Prepare update fields
      const updates: any = {};
      const values: any[] = [];
      
      if (username !== undefined) {
        // Check if username is already taken by another user
        const existingUser = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', username, id);
        if (existingUser) {
          return new Response(JSON.stringify({ error: 'Username already exists' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        updates.username = username;
        values.push(username);
      }
      if (email !== undefined) {
        updates.email = email;
        values.push(email);
      }
      if (role !== undefined) {
        updates.role = role;
        values.push(role);
      }
      if (is_active !== undefined) {
        updates.is_active = is_active;
        values.push(is_active);
      }
      if (password) {
        const hashedPassword = await hashPassword(password);
        updates.password_hash = hashedPassword;
        values.push(hashedPassword);
      }

      if (Object.keys(updates).length === 0) {
        return new Response(JSON.stringify({ error: 'No fields to update' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Add updated_at
      updates.updated_at = 'CURRENT_TIMESTAMP';

      // Build SQL
      const setClause = Object.keys(updates).map(key => 
        key === 'updated_at' ? `${key} = CURRENT_TIMESTAMP` : `${key} = ?`
      ).join(', ');
      
      values.push(id);

      await db.run(
        `UPDATE users SET ${setClause} WHERE id = ?`,
        ...values
      );

      const updatedUser = await db.get(
        'SELECT id, username, email, role, is_active, created_at, updated_at FROM users WHERE id = ?',
        id
      );

      logger.info(`Admin updated user "${currentUser.username}" (ID: ${id})`, 'AUTH');

      return updatedUser;
    }))
    .delete('/api/admin/users/:id', requireRole('admin')(async ({ params, user }: any) => {
      const { id } = params;

      // Prevent deleting yourself
      if (parseInt(id) === user.id) {
        return new Response(JSON.stringify({ error: 'Cannot delete your own account' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get user before deletion
      const userToDelete = await db.get('SELECT username FROM users WHERE id = ?', id);
      if (!userToDelete) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      await db.run('DELETE FROM users WHERE id = ?', id);

      logger.info(`Admin deleted user "${userToDelete.username}" (ID: ${id})`, 'AUTH');

      return { success: true };
    }))
    .get('/api/endpoints', async () => {
      const endpoints: Endpoint[] = await db.all('SELECT * FROM endpoints');
      const endpointsWithStats = await Promise.all(
        endpoints.map(async (endpoint) => {
          const lastResponse = await db.get(
            'SELECT response_time FROM response_times WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT 1',
            endpoint.id
          );

          const stats24h = await calculateGapAwareUptime(db, endpoint.id, endpoint.heartbeat_interval || 60, '1 day');
          const stats30d = await calculateGapAwareUptime(db, endpoint.id, endpoint.heartbeat_interval || 60, '30 days');
          const stats1y = await calculateGapAwareUptime(db, endpoint.id, endpoint.heartbeat_interval || 60, '365 days');

          const uptime_30d = stats30d?.uptime || 0;
          const uptime_1y = stats1y?.uptime || 0;
          
          let cert_expires_in = null;
          let cert_expiry_date = null;
          
          // Get actual certificate expiration if certificate checking is enabled
          if (endpoint.check_cert_expiry && endpoint.type === 'http') {
            try {
              const hostname = new URL(endpoint.url).hostname;
              const certDetails = await getCertificateExpiry(hostname);
              if (certDetails) {
                cert_expires_in = certDetails.daysRemaining;
                const expiryDate = new Date();
                expiryDate.setDate(expiryDate.getDate() + certDetails.daysRemaining);
                cert_expiry_date = expiryDate.toISOString();
              }
            } catch (err) {
              console.error(`Could not check SSL certificate for ${endpoint.url}`, err);
              cert_expires_in = null;
              cert_expiry_date = null;
            }
          }

          const result = {
            ...endpoint,
            ok_http_statuses: endpoint.ok_http_statuses ? JSON.parse(endpoint.ok_http_statuses) : [],
            http_headers: endpoint.http_headers ? JSON.parse(endpoint.http_headers) : null,
            kafka_config: endpoint.kafka_config ? JSON.parse(endpoint.kafka_config) : null,
            paused: Boolean(endpoint.paused), // Convert SQLite 0/1 to proper boolean
            upside_down_mode: Boolean(endpoint.upside_down_mode), // Also fix this one
            check_cert_expiry: Boolean(endpoint.check_cert_expiry), // And this one
            client_cert_enabled: Boolean(endpoint.client_cert_enabled), // mTLS enabled flag
            current_response: lastResponse?.response_time || 0,
            avg_response_24h: stats24h?.avg_response || 0,
            uptime_24h: stats24h?.uptime || 0,
            uptime_30d,
            uptime_1y,
            cert_expires_in,
            cert_expiry_date,
          };
          return result;
        })
      );
      return endpointsWithStats;
    })
    .get('/api/endpoints/:id/stats', async ({ params, query }) => {
      const { id } = params;
      const range = (query.range || '24h') as '3h' | '6h' | '24h' | '1w';

      // Get endpoint heartbeat interval for gap-aware calculation
      const endpoint = await db.get('SELECT heartbeat_interval FROM endpoints WHERE id = ?', id);
      const heartbeatInterval = endpoint?.heartbeat_interval || 60;

      const rangeToPeriod = {
        '3h': '3 hours',
        '6h': '6 hours', 
        '24h': '1 day',
        '1w': '7 days',
      };

      const period = rangeToPeriod[range];
      const stats = await calculateGapAwareUptime(db, parseInt(id), heartbeatInterval, period);

      return {
        avg_response: stats?.avg_response || 0,
        uptime: stats?.uptime || 0,
        monitoring_coverage: stats?.monitoring_coverage || 0,
      };
    })
    .get('/api/endpoints/:id/response-times', async ({ params, query }) => {
      const { id } = params;
      const range = (query.range || '24h') as '3h' | '6h' | '24h' | '1w';

      const rangeToSql = {
        '3h': "datetime('now', '-3 hours')",
        '6h': "datetime('now', '-6 hours')",
        '24h': "datetime('now', '-1 day')",
        '1w': "datetime('now', '-7 days')",
      };

      const since = rangeToSql[range];

      // Target around 60-80 data points for all time ranges
      let groupByFormat: string;
      let intervalMinutes: number;

      switch (range) {
        case '3h':
          // Group by 3-minute intervals for 3h (60 points)
          groupByFormat = "strftime('%Y-%m-%d %H:', created_at) || printf('%02d', (cast(strftime('%M', created_at) as integer) / 3) * 3)";
          intervalMinutes = 3;
          break;
        case '6h':
          // Group by 5-minute intervals for 6h (72 points)
          groupByFormat = "strftime('%Y-%m-%d %H:', created_at) || printf('%02d', (cast(strftime('%M', created_at) as integer) / 5) * 5)";
          intervalMinutes = 5;
          break;
        case '24h':
          // Group by 20-minute intervals for 24h (72 points)
          groupByFormat = "strftime('%Y-%m-%d %H:', created_at) || printf('%02d', (cast(strftime('%M', created_at) as integer) / 20) * 20)";
          intervalMinutes = 20;
          break;
        case '1w':
          // Group by 3-hour intervals for 1 week (56 points)
          groupByFormat = "strftime('%Y-%m-%d ', created_at) || printf('%02d:00:00', (cast(strftime('%H', created_at) as integer) / 3) * 3)";
          intervalMinutes = 180;
          break;
      }

      const aggregatedData = await db.all(
        `SELECT 
          ${groupByFormat} as time_bucket,
          AVG(response_time) as avg_response_time,
          MIN(response_time) as min_response_time,
          MAX(response_time) as max_response_time,
          -- Determine predominant status: if any DOWN, then DOWN, else UP
          CASE 
            WHEN COUNT(CASE WHEN status = 'DOWN' THEN 1 END) > 0 THEN 'DOWN'
            ELSE 'UP'
          END as status,
          -- Use the latest timestamp in the bucket as created_at
          MAX(created_at) as created_at,
          COUNT(*) as data_points
        FROM response_times 
        WHERE endpoint_id = ? AND created_at >= ${since}
        GROUP BY ${groupByFormat}
        ORDER BY created_at ASC`,
        id
      );

      // Transform the aggregated data to include min/max for banded chart
      return aggregatedData.map(row => ({
        id: 0, // Not used for charts
        endpoint_id: parseInt(id),
        response_time: Math.round(row.avg_response_time),
        min_response_time: row.min_response_time,
        max_response_time: row.max_response_time,
        status: row.status,
        created_at: row.created_at,
        data_points: row.data_points // Additional info about how many points were aggregated
      }));
    })
    .get('/api/endpoints/:id/outages', async ({ params, query }) => {
      const { id } = params;
      const limit = parseInt(query.limit as string) || 50;

      // Get all status changes for this endpoint, ordered by time
      const statusChanges = await db.all(
        `SELECT status, created_at, response_time
         FROM response_times 
         WHERE endpoint_id = ? 
         ORDER BY created_at DESC 
         LIMIT 1000`,
        id
      );

      const outages: Array<{
        started_at: string;
        ended_at: string | null;
        duration_ms: number | null;
        duration_text: string;
        reason: string;
      }> = [];

      let currentOutageStart: string | null = null;
      
      // Process status changes in reverse chronological order to build outage periods
      for (let i = statusChanges.length - 1; i >= 0; i--) {
        const change = statusChanges[i];
        
        if (change.status === 'DOWN' && !currentOutageStart) {
          // Start of an outage
          currentOutageStart = change.created_at;
        } else if (change.status === 'UP' && currentOutageStart) {
          // End of an outage
          const startTime = new Date(currentOutageStart);
          const endTime = new Date(change.created_at);
          const durationMs = endTime.getTime() - startTime.getTime();
          
          outages.push({
            started_at: currentOutageStart,
            ended_at: change.created_at,
            duration_ms: durationMs,
            duration_text: formatDuration(durationMs),
            reason: 'Service check failed' // Default reason as we don't track specific reasons yet
          });
          
          currentOutageStart = null;
        }
      }
      
      // If there's an ongoing outage
      if (currentOutageStart) {
        const startTime = new Date(currentOutageStart);
        const now = new Date();
        const durationMs = now.getTime() - startTime.getTime();
        
        outages.push({
          started_at: currentOutageStart,
          ended_at: null,
          duration_ms: durationMs,
          duration_text: formatDuration(durationMs) + ' (ongoing)',
          reason: 'Service check failed'
        });
      }

      // Sort by most recent first and limit results
      return outages.sort((a, b) => 
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      ).slice(0, limit);
    })
    .get('/api/endpoints/:id/heartbeats', async ({ params, query }) => {
      const { id } = params;
      const limit = parseInt(query.limit as string) || 24;

      // Get recent heartbeats for this endpoint, ordered by time (most recent first)
      const heartbeats = await db.all(
        `SELECT status, created_at, response_time
         FROM response_times 
         WHERE endpoint_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`,
        id,
        limit
      );

      // Return in chronological order (oldest first) for proper display
      return heartbeats.reverse();
    })
    .delete('/api/endpoints/:id/heartbeats', async ({ params }) => {
      const { id } = params;
      
      // Delete all heartbeat data (response_times) for this endpoint
      const result = await db.run('DELETE FROM response_times WHERE endpoint_id = ?', id);
      
      logger.info(`Deleted ${result.changes} heartbeat records for endpoint ID: ${id}`, 'DATA_MANAGEMENT');
      
      return { 
        success: true, 
        deletedCount: result.changes,
        message: `Deleted ${result.changes} heartbeat records` 
      };
    })
    .delete('/api/endpoints/:id/outages', async ({ params }) => {
      const { id } = params;
      
      // Since outages are calculated from response_times, deleting response_times clears outage history
      const result = await db.run('DELETE FROM response_times WHERE endpoint_id = ?', id);
      
      logger.info(`Deleted outage history (${result.changes} response records) for endpoint ID: ${id}`, 'DATA_MANAGEMENT');
      
      return { 
        success: true, 
        deletedCount: result.changes,
        message: `Deleted outage history (${result.changes} records)` 
      };
    })
    .post('/api/endpoints', requireRole('admin')(async ({ body }: any) => {
      const {
        url, name, type, heartbeat_interval, retries, upside_down_mode,
        http_method, http_headers, http_body, ok_http_statuses, check_cert_expiry, cert_expiry_threshold, keyword_search,
        client_cert_enabled, client_cert_public_key, client_cert_private_key, client_cert_ca,
        tcp_port,
        kafka_topic, kafka_message, kafka_config
      } = body as Endpoint;

      const result = await db.run(
        `INSERT INTO endpoints (
          url, name, type, status, heartbeat_interval, retries, upside_down_mode, paused,
          http_method, http_headers, http_body, ok_http_statuses, check_cert_expiry, cert_expiry_threshold, keyword_search,
          client_cert_enabled, client_cert_public_key, client_cert_private_key, client_cert_ca,
          tcp_port, kafka_topic, kafka_message, kafka_config
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        url, name || url, type, 'pending', heartbeat_interval || 60, retries || 3, upside_down_mode || false, false,
        http_method || 'GET', http_headers ? JSON.stringify(http_headers) : null, http_body || null,
        ok_http_statuses ? JSON.stringify(ok_http_statuses) : null, check_cert_expiry || false, cert_expiry_threshold || 30, keyword_search || null,
        client_cert_enabled || false, client_cert_public_key || null, client_cert_private_key || null, client_cert_ca || null,
        tcp_port, kafka_topic, kafka_message, kafka_config
      );

      // Get the newly created endpoint and start monitoring
      const newEndpoint = await db.get('SELECT * FROM endpoints WHERE id = ?', result.lastID);
      if (newEndpoint) {
        console.log(`Starting monitor for new endpoint "${newEndpoint.name}" (ID: ${newEndpoint.id}) with ${newEndpoint.heartbeat_interval}s interval`);
        startEndpointMonitoring(newEndpoint as Endpoint);
      }

      return { id: result.lastID, url, name: name || url, status: 'pending' };
    }))
    .put('/api/endpoints/:id', requireRole('admin')(async ({ params, body }: any) => {
      const { id } = params;
      const {
        name, url, type, heartbeat_interval, retries, upside_down_mode,
        http_method, http_headers, http_body, ok_http_statuses, check_cert_expiry, cert_expiry_threshold, keyword_search,
        client_cert_enabled, client_cert_public_key, client_cert_private_key, client_cert_ca,
        tcp_port,
        kafka_topic, kafka_message, kafka_config
      } = body as Endpoint;

      await db.run(
        `UPDATE endpoints SET 
          name = ?, url = ?, type = ?, heartbeat_interval = ?, retries = ?, upside_down_mode = ?,
          http_method = ?, http_headers = ?, http_body = ?, ok_http_statuses = ?, check_cert_expiry = ?, cert_expiry_threshold = ?, keyword_search = ?,
          client_cert_enabled = ?, client_cert_public_key = ?, client_cert_private_key = ?, client_cert_ca = ?,
          tcp_port = ?, kafka_topic = ?, kafka_message = ?, kafka_config = ?
        WHERE id = ?`,
        name, url, type, heartbeat_interval, retries, upside_down_mode,
        http_method, http_headers ? JSON.stringify(http_headers) : null, http_body,
        ok_http_statuses ? JSON.stringify(ok_http_statuses) : null, check_cert_expiry, cert_expiry_threshold, keyword_search || null,
        client_cert_enabled || false, client_cert_public_key || null, client_cert_private_key || null, client_cert_ca || null,
        tcp_port, kafka_topic, kafka_message, kafka_config,
        id
      );

      // Get the updated endpoint and restart monitoring with new settings
      const updatedEndpoint = await db.get('SELECT * FROM endpoints WHERE id = ?', id);
      if (updatedEndpoint) {
        console.log(`Restarting monitor for endpoint "${updatedEndpoint.name}" (ID: ${updatedEndpoint.id}) with ${updatedEndpoint.heartbeat_interval}s interval`);
        stopEndpointMonitoring(parseInt(id));
        startEndpointMonitoring(updatedEndpoint as Endpoint);
      }

      return { id, name, url };
    }))
    .delete('/api/endpoints/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;
      
      // Stop monitoring for this endpoint
      console.log(`Stopping monitor for endpoint ID: ${id}`);
      stopEndpointMonitoring(parseInt(id));
      
      await db.run('DELETE FROM endpoints WHERE id = ?', id);
      return { id };
    }))
    .post('/api/endpoints/:id/toggle-pause', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;
      
      // Get current pause status
      const endpoint = await db.get('SELECT * FROM endpoints WHERE id = ?', id);
      if (!endpoint) {
        throw new Error('Endpoint not found');
      }
      
      const newPausedState = !endpoint.paused;
      
      // Update pause status in database
      await db.run('UPDATE endpoints SET paused = ? WHERE id = ?', newPausedState, id);
      
      if (newPausedState) {
        // Pausing: stop monitoring
        console.log(`Pausing monitor for endpoint "${endpoint.name}" (ID: ${id})`);
        stopEndpointMonitoring(parseInt(id));
      } else {
        // Unpausing: start monitoring
        console.log(`Resuming monitor for endpoint "${endpoint.name}" (ID: ${id})`);
        const updatedEndpoint = await db.get('SELECT * FROM endpoints WHERE id = ?', id);
        if (updatedEndpoint) {
          startEndpointMonitoring(updatedEndpoint as Endpoint);
        }
      }
      
      return { id, paused: newPausedState };
    }))
    .get('/api/notification-services', async () => {
      const services = await db.all('SELECT * FROM notification_services');
      return services.map(service => ({
        ...service,
        config: JSON.parse(service.config)
      }));
    })
    .post('/api/notification-services', async ({ body }) => {
      const { name, type, config } = body as { name: string, type: string, config: object };
      const result = await db.run(
        'INSERT INTO notification_services (name, type, config) VALUES (?, ?, ?)',
        name,
        type,
        JSON.stringify(config)
      );
      return { id: result.lastID, name, type, config };
    })
    .put('/api/notification-services/:id', async ({ params, body }) => {
      const { id } = params;
      const { name, type, config } = body as { name: string, type: string, config: object };
      await db.run(
        'UPDATE notification_services SET name = ?, type = ?, config = ? WHERE id = ?',
        name,
        type,
        JSON.stringify(config),
        id
      );
      return { id, name, type, config };
    })
    .delete('/api/notification-services/:id', async ({ params }) => {
      const { id } = params;
      await db.run('DELETE FROM notification_services WHERE id = ?', id);
      return { id };
    })
    .get('/api/endpoints/:id/notification-services', async ({ params }) => {
      const { id } = params;
      const services = await db.all(
        `SELECT ns.* FROM notification_services ns
         JOIN monitor_notification_services mns ON ns.id = mns.notification_service_id
         WHERE mns.monitor_id = ?`,
        id
      );
      return services.map(service => ({
        ...service,
        config: JSON.parse(service.config)
      }));
    })
    .post('/api/endpoints/:id/notification-services', async ({ params, body }) => {
      const { id } = params;
      const { serviceId } = body as { serviceId: number };
      await db.run(
        'INSERT INTO monitor_notification_services (monitor_id, notification_service_id) VALUES (?, ?)',
        id,
        serviceId
      );
      return { monitor_id: id, notification_service_id: serviceId };
    })
    .delete('/api/endpoints/:id/notification-services/:serviceId', async ({ params }) => {
      const { id, serviceId } = params;
      await db.run(
        'DELETE FROM monitor_notification_services WHERE monitor_id = ? AND notification_service_id = ?',
        id,
        serviceId
      );
      return { monitor_id: id, notification_service_id: serviceId };
    })
    .get('/api/logs', async () => {
      const logs = await db.all(
        'SELECT * FROM application_logs ORDER BY timestamp DESC LIMIT 1000'
      );
      return logs;
    })
    .delete('/api/logs', async () => {
      await db.run('DELETE FROM application_logs');
      return { success: true };
    })
    .get('/api/logs/level', async () => {
      // For now, return a default log level. In a real app, this would be stored in config
      return { level: 'info' };
    })
    .put('/api/logs/level', async ({ body }) => {
      const { level } = body as { level: string };
      // For now, just return success. In a real app, this would update the config
      // You could store this in the database or a config file
      return { level };
    })
    .get('/api/database/stats', async () => {
      // Get database file size
      const dbFile = Bun.file('./db.sqlite');
      const fileSize = (await dbFile.size) / 1024 / 1024; // Convert to MB
      
      // Get table information
      const tables = await db.all(`
        SELECT 
          name,
          (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=m.name) as table_count
        FROM sqlite_master m WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `);
      
      const tableStats = await Promise.all(
        tables.map(async (table) => {
          const count = await db.get(`SELECT COUNT(*) as count FROM ${table.name}`);
          return {
            name: table.name,
            rows: count.count,
            size: 'N/A' // SQLite doesn't easily provide per-table sizes
          };
        })
      );

      return {
        size: `${fileSize.toFixed(2)} MB`,
        tables: tableStats
      };
    })
    .post('/api/database/vacuum', async () => {
      try {
        await db.exec('VACUUM');
        return { success: true };
      } catch (error) {
        throw new Error('Failed to vacuum database');
      }
    })
    // Status Pages API
    .get('/api/status-pages', async () => {
      const statusPages = await db.all('SELECT * FROM status_pages ORDER BY created_at DESC');
      return statusPages.map(page => ({
        ...page,
        monitor_ids: JSON.parse(page.monitor_ids),
        is_public: Boolean(page.is_public)
      }));
    })
    .post('/api/status-pages', async ({ body }) => {
      const { name, slug, description, is_public, monitor_ids } = body as {
        name: string;
        slug: string;
        description?: string;
        is_public: boolean;
        monitor_ids: number[];
      };

      // Check if slug already exists
      const existingPage = await db.get('SELECT id FROM status_pages WHERE slug = ?', slug);
      if (existingPage) {
        throw new Error('A status page with this slug already exists');
      }

      const result = await db.run(
        'INSERT INTO status_pages (name, slug, description, is_public, monitor_ids) VALUES (?, ?, ?, ?, ?)',
        name,
        slug,
        description || null,
        is_public,
        JSON.stringify(monitor_ids)
      );

      const newPage = await db.get('SELECT * FROM status_pages WHERE id = ?', result.lastID);
      return {
        ...newPage,
        monitor_ids: JSON.parse(newPage.monitor_ids),
        is_public: Boolean(newPage.is_public)
      };
    })
    .put('/api/status-pages/:id', async ({ params, body }) => {
      const { id } = params;
      const { name, slug, description, is_public, monitor_ids } = body as {
        name: string;
        slug: string;
        description?: string;
        is_public: boolean;
        monitor_ids: number[];
      };

      // Check if slug already exists for a different page
      const existingPage = await db.get('SELECT id FROM status_pages WHERE slug = ? AND id != ?', slug, id);
      if (existingPage) {
        throw new Error('A status page with this slug already exists');
      }

      await db.run(
        'UPDATE status_pages SET name = ?, slug = ?, description = ?, is_public = ?, monitor_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        name,
        slug,
        description || null,
        is_public,
        JSON.stringify(monitor_ids),
        id
      );

      const updatedPage = await db.get('SELECT * FROM status_pages WHERE id = ?', id);
      return {
        ...updatedPage,
        monitor_ids: JSON.parse(updatedPage.monitor_ids),
        is_public: Boolean(updatedPage.is_public)
      };
    })
    .delete('/api/status-pages/:id', async ({ params }) => {
      const { id } = params;
      await db.run('DELETE FROM status_pages WHERE id = ?', id);
      return { success: true };
    })
    .get('/api/status-pages/public/:slug', async ({ params }) => {
      const { slug } = params;
      
      const statusPage = await db.get('SELECT * FROM status_pages WHERE slug = ? AND is_public = 1', slug);
      if (!statusPage) {
        throw new Error('Status page not found');
      }

      return {
        ...statusPage,
        monitor_ids: JSON.parse(statusPage.monitor_ids),
        is_public: Boolean(statusPage.is_public)
      };
    })
    .get('/api/status-pages/:id/monitors', async ({ params }) => {
      const { id } = params;
      
      const statusPage = await db.get('SELECT monitor_ids FROM status_pages WHERE id = ?', id);
      if (!statusPage) {
        throw new Error('Status page not found');
      }

      const monitorIds = JSON.parse(statusPage.monitor_ids);
      if (monitorIds.length === 0) {
        return [];
      }

      // Get the monitors for this status page
      const placeholders = monitorIds.map(() => '?').join(',');
      const monitors = await db.all(
        `SELECT * FROM endpoints WHERE id IN (${placeholders})`,
        ...monitorIds
      );

      // Add stats for each monitor
      const monitorsWithStats = await Promise.all(
        monitors.map(async (monitor) => {
          const lastResponse = await db.get(
            'SELECT response_time FROM response_times WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT 1',
            monitor.id
          );

          const stats24h = await calculateGapAwareUptime(db, monitor.id, monitor.heartbeat_interval || 60, '1 day');

          return {
            ...monitor,
            ok_http_statuses: monitor.ok_http_statuses ? JSON.parse(monitor.ok_http_statuses) : [],
            http_headers: monitor.http_headers ? JSON.parse(monitor.http_headers) : null,
            kafka_config: monitor.kafka_config ? JSON.parse(monitor.kafka_config) : null,
            paused: Boolean(monitor.paused),
            upside_down_mode: Boolean(monitor.upside_down_mode),
            check_cert_expiry: Boolean(monitor.check_cert_expiry),
            client_cert_enabled: Boolean(monitor.client_cert_enabled),
            current_response: lastResponse?.response_time || 0,
            avg_response_24h: stats24h?.avg_response || 0,
            uptime_24h: stats24h?.uptime || 0,
          };
        })
      );

      return monitorsWithStats;
    })
    .get('/*', async ({ request }) => {
      const url = new URL(request.url);
      const assetPath = url.pathname === '/' ? 'index.html' : url.pathname.substring(1);
      const filePath = path.join(import.meta.dir, '..', 'frontend', 'dist', assetPath);

      const file = Bun.file(filePath);
      if (await file.exists()) {
          return file;
      }

      const indexPath = path.join(import.meta.dir, '..', 'frontend', 'dist', 'index.html');
      return Bun.file(indexPath);
    })
    .listen(3001);

  console.log(
    `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
  );

  // Store active timers for each endpoint
  const endpointTimers = new Map<number, NodeJS.Timeout>();

  // Function to check a single endpoint
  const checkSingleEndpoint = async (endpoint: Endpoint) => {
    const startTime = Date.now();
    let isOk = false;
    let responseTime = 0;

    try {
      switch (endpoint.type) {
        case 'http':
          if (endpoint.check_cert_expiry) {
            try {
              const hostname = new URL(endpoint.url).hostname;
              const certDetails = await getCertificateExpiry(hostname);
              if (certDetails && certDetails.daysRemaining !== undefined) {
                const daysRemaining = certDetails.daysRemaining;
                if (daysRemaining <= endpoint.cert_expiry_threshold!) {
                  sendNotification(endpoint, `Certificate for ${endpoint.url} is expiring in ${daysRemaining} days.`);
                }
              }
            } catch (err) {
              // Certificate checking failed, but this should not affect endpoint monitoring
              // Just log as info since this is not critical for the main monitoring functionality
              console.info(`Could not check SSL certificate for ${endpoint.url} - this is normal for sites with certificate issues`);
            }
          }
          const headers = endpoint.http_headers ? JSON.parse(endpoint.http_headers) : undefined;
          const body = endpoint.http_body;
          const method = endpoint.http_method || 'GET';

          // Create mTLS agent if client certificates are enabled
          const agent = createHttpAgent(endpoint);
          
          let response: Response;
          if (agent && endpoint.url.startsWith('https://')) {
            // Use Node.js HTTPS with mTLS for HTTPS URLs when mTLS is enabled
            const url = new URL(endpoint.url);
            const requestOptions = {
              hostname: url.hostname,
              port: url.port || 443,
              path: url.pathname + url.search,
              method,
              headers,
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
          const kafkaConfig = endpoint.kafka_config ? JSON.parse(endpoint.kafka_config) : {};
          
          // Add mTLS configuration to Kafka if client certificates are enabled
          const kafkaOptions: any = {
            clientId: 'monitor-app',
            brokers: [endpoint.url],
            logLevel: logLevel.ERROR,
            ...kafkaConfig,
          };

          if (endpoint.client_cert_enabled && endpoint.client_cert_private_key && endpoint.client_cert_public_key) {
            kafkaOptions.ssl = {
              cert: endpoint.client_cert_public_key,
              key: endpoint.client_cert_private_key,
              rejectUnauthorized: true,
            };

            // Add CA certificate if provided
            if (endpoint.client_cert_ca) {
              kafkaOptions.ssl.ca = endpoint.client_cert_ca;
            }
          }

          const kafka = new Kafka(kafkaOptions);
          if (endpoint.type === 'kafka_producer') {
            const producer = kafka.producer();
            await producer.connect();
            await producer.send({
              topic: endpoint.kafka_topic!,
              messages: [{ value: endpoint.kafka_message || 'test message' }],
            });
            await producer.disconnect();
            isOk = true;
          } else { // kafka_consumer
            const consumer = kafka.consumer({ groupId: `monitor-app-consumer-${endpoint.id}` });
            await consumer.connect();
            await consumer.subscribe({ topic: endpoint.kafka_topic!, fromBeginning: true });
            isOk = await new Promise(async (resolve) => {
              consumer.run({
                eachMessage: async () => {
                  resolve(true);
                  await consumer.disconnect();
                },
              });
              // Timeout if no message is received
              setTimeout(async () => {
                resolve(false);
                await consumer.disconnect();
              }, 10000);
            });
          }
          responseTime = Date.now() - startTime;
          break;
      }

      if (endpoint.upside_down_mode) {
        isOk = !isOk;
      }

      if (isOk) {
        if (endpoint.status !== 'UP') {
          sendNotification(endpoint, 'UP');
        }
        await db.run('UPDATE endpoints SET status = ?, failed_attempts = 0, last_checked = CURRENT_TIMESTAMP WHERE id = ?', 'UP', endpoint.id);
        await db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', endpoint.id, responseTime, 'UP');
      } else {
        throw new Error('Check failed');
      }
    } catch (error) {
      responseTime = responseTime || (Date.now() - startTime);
      const newFailedAttempts = (endpoint.failed_attempts || 0) + 1;
      if (newFailedAttempts >= (endpoint.retries || 3)) {
        if (endpoint.status !== 'DOWN') {
          sendNotification(endpoint, 'DOWN');
        }
        await db.run('UPDATE endpoints SET status = ?, failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', 'DOWN', newFailedAttempts, endpoint.id);
      } else {
        await db.run('UPDATE endpoints SET failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', newFailedAttempts, endpoint.id);
      }
      await db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', endpoint.id, responseTime, 'DOWN');
    }
  };

  // Function to start monitoring for a single endpoint
  const startEndpointMonitoring = (endpoint: Endpoint) => {
    // Clear existing timer if any
    if (endpointTimers.has(endpoint.id)) {
      clearTimeout(endpointTimers.get(endpoint.id)!);
    }

    // Don't start monitoring if endpoint is paused
    if (endpoint.paused) {
      console.log(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) is paused - skipping monitoring`);
      return;
    }

    const scheduleCheck = () => {
      const timer = setTimeout(async () => {
        try {
          // Check if endpoint is still not paused before running check
          const currentEndpoint = await db.get('SELECT paused FROM endpoints WHERE id = ?', endpoint.id);
          if (!currentEndpoint?.paused) {
            await checkSingleEndpoint(endpoint);
          } else {
            console.log(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) was paused - stopping monitoring`);
            stopEndpointMonitoring(endpoint.id);
            return;
          }
        } catch (err) {
          console.error(`Error checking endpoint ${endpoint.id} (${endpoint.name}):`, err);
        }
        // Schedule the next check
        scheduleCheck();
      }, (endpoint.heartbeat_interval || 60) * 1000);

      endpointTimers.set(endpoint.id, timer);
    };

    // Start the first check immediately, then schedule subsequent checks
    setTimeout(async () => {
      try {
        const currentEndpoint = await db.get('SELECT paused FROM endpoints WHERE id = ?', endpoint.id);
        if (!currentEndpoint?.paused) {
          await checkSingleEndpoint(endpoint);
        } else {
          console.log(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) was paused - not starting monitoring`);
          return;
        }
      } catch (err) {
        console.error(`Error in initial check for endpoint ${endpoint.id} (${endpoint.name}):`, err);
      }
      // Schedule subsequent checks
      scheduleCheck();
    }, 1000); // Small delay to avoid overwhelming on startup
  };

  // Function to stop monitoring for an endpoint
  const stopEndpointMonitoring = (endpointId: number) => {
    if (endpointTimers.has(endpointId)) {
      clearTimeout(endpointTimers.get(endpointId)!);
      endpointTimers.delete(endpointId);
    }
  };

  // Initialize monitoring for all existing endpoints
  const initializeMonitoring = async () => {
    try {
      const endpoints: Endpoint[] = await db.all('SELECT * FROM endpoints');
      logger.info(`Starting monitoring for ${endpoints.length} endpoints`, 'MONITORING');
      
      for (const endpoint of endpoints) {
        logger.info(`Starting monitor for "${endpoint.name}" (ID: ${endpoint.id}) with ${endpoint.heartbeat_interval || 60}s interval`, 'MONITORING');
        startEndpointMonitoring(endpoint);
      }
    } catch (err) {
      logger.error(`Error initializing monitoring: ${err}`, 'MONITORING');
    }
  };

  // Start monitoring all endpoints
  initializeMonitoring();
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;
    if (days === 1 && remainingHours === 0 && remainingMinutes === 0) {
      return '1 day';
    } else if (remainingHours === 0 && remainingMinutes === 0) {
      return `${days} days`;
    } else if (remainingHours > 0 && remainingMinutes === 0) {
      return `${days}d ${remainingHours}h`;
    } else if (remainingHours === 0) {
      return `${days}d ${remainingMinutes}m`;
    } else {
      return `${days}d ${remainingHours}h ${remainingMinutes}m`;
    }
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours}h`;
    } else {
      return `${hours}h ${remainingMinutes}m`;
    }
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes}m`;
    } else {
      return `${minutes}m ${remainingSeconds}s`;
    }
  } else {
    return `${seconds}s`;
  }
}

async function getCertificateExpiry(hostname: string): Promise<{ daysRemaining: number } | null> {
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

main();
