import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import path from 'path';
import { Database } from 'bun:sqlite';
import ping from 'ping';
import net from 'net';
import { spawn } from 'child_process';
import tls from 'tls';
import { Kafka, logLevel } from 'kafkajs';
import https from 'https';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import { Issuer, type Client, generators } from 'openid-client';
import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import { gzipSync } from 'bun';

// Import types and configuration
import type { MonitorType, User, OIDCProvider, UserSession, Endpoint } from './src/types';
import { JWT_SECRET, JWT_EXPIRES_IN, DB_PATH } from './src/config/constants';
import { initializeDatabase } from './src/config/database';

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
  const checks = db.query(
    `SELECT created_at, status, response_time
     FROM response_times 
     WHERE endpoint_id = ? AND created_at >= datetime('now', '-${period}')
     ORDER BY created_at ASC`
  ).all(endpointId) as any[];

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

async function main() {
  // Initialize database
  const db = initializeDatabase();

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
        db.run(
          'INSERT INTO application_logs (level, message, component) VALUES (?, ?, ?)',
          [level, message, component || null]
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
      const user = db.query('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.id) as User | null;

    return user;
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
    const userCount = db.query('SELECT COUNT(*) as count FROM users').get() as any;
    if (userCount.count === 0) {
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
      const hashedPassword = await hashPassword(defaultPassword);
      
      db.run(
        'INSERT INTO users (username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)',
        ['admin', 'admin@localhost', hashedPassword, 'admin', true]
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
      const provider = db.query('SELECT * FROM oidc_providers WHERE id = ? AND is_active = 1').get(providerId) as any;
    if (!provider) {
      return null;
    }

    try {
      // Discover the issuer
      const issuer = await Issuer.discover(provider.issuer_url);
      
      // Use configurable redirect base URL
      const redirectBaseUrl = provider.redirect_base_url || 'http://localhost:3001';
      
      // Create client
      const client = new issuer.Client({
        client_id: provider.client_id,
        client_secret: provider.client_secret,
        redirect_uris: [`${redirectBaseUrl}/api/auth/oidc/callback/${providerId}`],
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
    const services = db.query(
      `SELECT ns.* FROM notification_services ns
       JOIN monitor_notification_services mns ON ns.id = mns.notification_service_id
       WHERE mns.monitor_id = ?`
    ).all(endpoint.id) as any[];

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
    const endpoints: Endpoint[] = db.query('SELECT * FROM endpoints').all() as Endpoint[];
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
        db.run('UPDATE endpoints SET status = ?, failed_attempts = 0, last_checked = CURRENT_TIMESTAMP WHERE id = ?', ['UP', endpoint.id]);
        db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', [endpoint.id, responseTime, 'UP']);
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
        db.run('UPDATE endpoints SET status = ?, failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', ['DOWN', newFailedAttempts, endpoint.id]);
      } else {
        logger.warn(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) check failed (attempt ${newFailedAttempts}/${endpoint.retries}). Error: ${error}`, 'MONITORING');
        db.run('UPDATE endpoints SET failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', [newFailedAttempts, endpoint.id]);
      }
      db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', [endpoint.id, responseTime, 'DOWN']);
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
      const user = db.query('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username) as any;

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
      db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

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
      const providers = db.query('SELECT id, name, issuer_url FROM oidc_providers WHERE is_active = 1 ORDER BY name').all() as any[];
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
      const provider = db.query('SELECT scopes FROM oidc_providers WHERE id = ?').get(providerId) as any;
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
        // Get provider for redirect URL
        const provider = db.query('SELECT redirect_base_url FROM oidc_providers WHERE id = ?').get(providerId) as any;
        const redirectBaseUrl = provider?.redirect_base_url || 'http://localhost:3001';

        // Exchange authorization code for tokens
        const tokenSet = await client.callback(
          `${redirectBaseUrl}/api/auth/oidc/callback/${providerId}`,
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
        let user = db.query('SELECT * FROM users WHERE oidc_provider_id = ? AND oidc_subject = ? AND is_active = 1').get(providerId, subject) as any;

        if (!user) {
          // Check if user exists with same email
          if (email) {
            const existingEmailUser = db.query('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email) as any;
            
            if (existingEmailUser) {
              // Link existing user to OIDC provider
              db.run('UPDATE users SET oidc_provider_id = ?, oidc_subject = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [providerId, subject, existingEmailUser.id]);
              user = existingEmailUser;
              logger.info(`Linked existing user "${existingEmailUser.username}" to OIDC provider ${providerId}`, 'OIDC');
            }
          }

          if (!user) {
            // Create new user
            const result = db.run('INSERT INTO users (username, email, oidc_provider_id, oidc_subject, role, is_active) VALUES (?, ?, ?, ?, ?, ?)', [username, email || null, providerId, subject, 'user', true]);

            user = db.query('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as any;
            logger.info(`Created new OIDC user "${username}" for provider ${providerId}`, 'OIDC');
          }
        }

        // Update last login
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

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
      const providers = db.query('SELECT * FROM oidc_providers ORDER BY created_at DESC').all() as any[];
      return providers.map(provider => ({
        ...provider,
        is_active: Boolean(provider.is_active)
      }));
    }))
    .post('/api/admin/oidc-providers', requireRole('admin')(async ({ body }: any) => {
      const { name, issuer_url, client_id, client_secret, scopes, redirect_base_url } = body as {
        name: string;
        issuer_url: string;
        client_id: string;
        client_secret: string;
        scopes?: string;
        redirect_base_url?: string;
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

      const result = db.run('INSERT INTO oidc_providers (name, issuer_url, client_id, client_secret, scopes, redirect_base_url, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, issuer_url, client_id, client_secret, scopes || 'openid profile email', redirect_base_url || 'http://localhost:3001', true]);

      const newProvider = db.query('SELECT * FROM oidc_providers WHERE id = ?').get(result.lastInsertRowid) as any;
      
      logger.info(`Admin created OIDC provider "${name}"`, 'OIDC');

      return {
        ...newProvider,
        is_active: Boolean(newProvider.is_active)
      };
    }))
    .put('/api/admin/oidc-providers/:id', requireRole('admin')(async ({ params, body }: any) => {
      const { id } = params;
      const { name, issuer_url, client_id, client_secret, scopes, redirect_base_url, is_active } = body as {
        name?: string;
        issuer_url?: string;
        client_id?: string;
        client_secret?: string;
        scopes?: string;
        redirect_base_url?: string;
        is_active?: boolean;
      };

      // Get current provider
      const currentProvider = db.query('SELECT * FROM oidc_providers WHERE id = ?').get(id) as any;
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

      // Update provider
      db.run('UPDATE oidc_providers SET name = ?, issuer_url = ?, client_id = ?, client_secret = ?, scopes = ?, redirect_base_url = ?, is_active = ? WHERE id = ?', 
        name || currentProvider.name,
        issuer_url || currentProvider.issuer_url,
        client_id || currentProvider.client_id,
        client_secret || currentProvider.client_secret,
        scopes || currentProvider.scopes,
        redirect_base_url || currentProvider.redirect_base_url,
        is_active !== undefined ? is_active : currentProvider.is_active,
        id
      );

      // Clear cached client if configuration changed
      if (issuer_url !== undefined || client_id !== undefined || client_secret !== undefined || redirect_base_url !== undefined) {
        oidcClients.delete(parseInt(id));
      }

      const updatedProvider = db.query('SELECT * FROM oidc_providers WHERE id = ?').get(id) as any;

      logger.info(`Admin updated OIDC provider "${currentProvider.name}" (ID: ${id})`, 'OIDC');

      return {
        ...updatedProvider,
        is_active: Boolean(updatedProvider.is_active)
      };
    }))
    .delete('/api/admin/oidc-providers/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;

      // Get provider before deletion
      const provider = db.query('SELECT name FROM oidc_providers WHERE id = ?').get(id) as any;
      if (!provider) {
        return new Response(JSON.stringify({ error: 'OIDC provider not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if any users are linked to this provider
      const linkedUsers = db.query('SELECT COUNT(*) as count FROM users WHERE oidc_provider_id = ?').get(id) as any;

      if (linkedUsers.count > 0) {
        return new Response(JSON.stringify({ 
          error: `Cannot delete OIDC provider "${provider.name}" as ${linkedUsers.count} user(s) are linked to it` 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      db.run('DELETE FROM oidc_providers WHERE id = ?', [id]);

      // Clear cached client
      oidcClients.delete(parseInt(id));

      logger.info(`Admin deleted OIDC provider "${provider.name}" (ID: ${id})`, 'OIDC');

      return { success: true };
    }))
    // User management API (admin only)
    .get('/api/admin/users', requireRole('admin')(async () => {
      const users = db.query('SELECT id, username, email, role, is_active, created_at, updated_at, last_login FROM users ORDER BY created_at DESC').all() as any[];
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
      const existingUser = db.query('SELECT id FROM users WHERE username = ?').get(username) as any;
      if (existingUser) {
        return new Response(JSON.stringify({ error: 'Username already exists' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Hash password
      const hashedPassword = await hashPassword(password);

      // Create user
      const result = db.run('INSERT INTO users (username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)', [username, email || null, hashedPassword, role || 'user', true]);

      const newUser = db.query('SELECT id, username, email, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid) as any;

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
      const currentUser = db.query('SELECT * FROM users WHERE id = ?').get(id) as any;
      if (!currentUser) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Update user
      let hashedPassword = currentUser.password_hash;
      if (password) {
        hashedPassword = await hashPassword(password);
      }

      db.run('UPDATE users SET username = ?, email = ?, role = ?, is_active = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        username || currentUser.username,
        email || currentUser.email,
        role || currentUser.role,
        is_active !== undefined ? is_active : currentUser.is_active,
        hashedPassword,
        id
      );

      const updatedUser = db.query('SELECT id, username, email, role, is_active, created_at, updated_at FROM users WHERE id = ?').get(id) as any;

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
      const userToDelete = db.query('SELECT username FROM users WHERE id = ?').get(id) as any;
      if (!userToDelete) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      db.run('DELETE FROM users WHERE id = ?', [id]);

      logger.info(`Admin deleted user "${userToDelete.username}" (ID: ${id})`, 'AUTH');

      return { success: true };
    }))
    .get('/api/endpoints', async () => {
      const endpoints: Endpoint[] = db.query('SELECT * FROM endpoints').all() as Endpoint[];
      const endpointsWithStats = await Promise.all(
        endpoints.map(async (endpoint) => {
          const lastResponse = db.query('SELECT response_time FROM response_times WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT 1').get(endpoint.id) as any;

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
            paused: Boolean(endpoint.paused),
            upside_down_mode: Boolean(endpoint.upside_down_mode),
            check_cert_expiry: Boolean(endpoint.check_cert_expiry),
            client_cert_enabled: Boolean(endpoint.client_cert_enabled),
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
      const endpoint = db.query('SELECT heartbeat_interval FROM endpoints WHERE id = ?').get(id) as any;
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

      const aggregatedData = db.query(
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
        ORDER BY created_at ASC`
      ).all(id) as any[];

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
      const statusChanges = db.query(
        `SELECT status, created_at, response_time
         FROM response_times 
         WHERE endpoint_id = ? 
         ORDER BY created_at DESC 
         LIMIT 1000`
      ).all(id) as any[];

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
      const heartbeats = db.query(
        `SELECT status, created_at, response_time
         FROM response_times 
         WHERE endpoint_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`
      ).all(id, limit) as any[];

      // Return in chronological order (oldest first) for proper display
      return heartbeats.reverse();
    })
    .delete('/api/endpoints/:id/heartbeats', async ({ params }) => {
      const { id } = params;
      
      // Delete all heartbeat data (response_times) for this endpoint
      const result = db.run('DELETE FROM response_times WHERE endpoint_id = ?', [id]);
      
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
      const result = db.run('DELETE FROM response_times WHERE endpoint_id = ?', [id]);
      
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

      const result = db.run(
        `INSERT INTO endpoints (
          url, name, type, status, heartbeat_interval, retries, upside_down_mode, paused,
          http_method, http_headers, http_body, ok_http_statuses, check_cert_expiry, cert_expiry_threshold, keyword_search,
          client_cert_enabled, client_cert_public_key, client_cert_private_key, client_cert_ca,
          tcp_port, kafka_topic, kafka_message, kafka_config
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [url, name || url, type, 'pending', heartbeat_interval || 60, retries || 3, upside_down_mode || false, false,
        http_method || 'GET', http_headers ? JSON.stringify(http_headers) : null, http_body || null,
        ok_http_statuses ? JSON.stringify(ok_http_statuses) : null, check_cert_expiry || false, cert_expiry_threshold || 30, keyword_search || null,
        client_cert_enabled || false, client_cert_public_key || null, client_cert_private_key || null, client_cert_ca || null,
        tcp_port ?? null, kafka_topic ?? null, kafka_message ?? null, kafka_config ?? null]
      );

      // Get the newly created endpoint
      const newEndpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(result.lastInsertRowid) as any;

      return { id: result.lastInsertRowid, url, name: name || url, status: 'pending' };
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

      db.run(
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

      return { id, name, url };
    }))
    .delete('/api/endpoints/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;
      
      db.run('DELETE FROM endpoints WHERE id = ?', [id]);
      return { id };
    }))
    .post('/api/endpoints/:id/toggle-pause', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;
      
      // Get current pause status
      const endpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as any;
      if (!endpoint) {
        throw new Error('Endpoint not found');
      }
      
      const newPausedState = !endpoint.paused;
      
      // Update pause status in database
      db.run('UPDATE endpoints SET paused = ? WHERE id = ?', [newPausedState, id]);
      
      return { id, paused: newPausedState };
    }))
    .get('/api/notification-services', async () => {
      const services = db.query('SELECT * FROM notification_services').all() as any[];
      return services.map(service => ({
        ...service,
        config: JSON.parse(service.config)
      }));
    })
    .post('/api/notification-services', async ({ body }) => {
      const { name, type, config } = body as { name: string, type: string, config: object };
      const result = db.run('INSERT INTO notification_services (name, type, config) VALUES (?, ?, ?)', [name, type, JSON.stringify(config)]);
      return { id: result.lastInsertRowid, name, type, config };
    })
    .put('/api/notification-services/:id', async ({ params, body }) => {
      const { id } = params;
      const { name, type, config } = body as { name: string, type: string, config: object };
      db.run('UPDATE notification_services SET name = ?, type = ?, config = ? WHERE id = ?', [name, type, JSON.stringify(config), id]);
      return { id, name, type, config };
    })
    .delete('/api/notification-services/:id', async ({ params }) => {
      const { id } = params;
      db.run('DELETE FROM notification_services WHERE id = ?', [id]);
      return { id };
    })
    .get('/api/endpoints/:id/notification-services', async ({ params }) => {
      const { id } = params;
      const services = db.query(
        `SELECT ns.* FROM notification_services ns
         JOIN monitor_notification_services mns ON ns.id = mns.notification_service_id
         WHERE mns.monitor_id = ?`
      ).all(id) as any[];
      return services.map(service => ({
        ...service,
        config: JSON.parse(service.config)
      }));
    })
    .post('/api/endpoints/:id/notification-services', async ({ params, body }) => {
      const { id } = params;
      const { serviceId } = body as { serviceId: number };
      db.run('INSERT INTO monitor_notification_services (monitor_id, notification_service_id) VALUES (?, ?)', [id, serviceId]);
      return { monitor_id: id, notification_service_id: serviceId };
    })
    .delete('/api/endpoints/:id/notification-services/:serviceId', async ({ params }) => {
      const { id, serviceId } = params;
      db.run('DELETE FROM monitor_notification_services WHERE monitor_id = ? AND notification_service_id = ?', [id, serviceId]);
      return { monitor_id: id, notification_service_id: serviceId };
    })
    // Status Pages API
    .get('/api/status-pages', async () => {
      const statusPages = db.query('SELECT * FROM status_pages ORDER BY created_at DESC').all() as any[];
      return statusPages.map(page => ({
        ...page,
        is_public: Boolean(page.is_public),
        monitor_ids: JSON.parse(page.monitor_ids)
      }));
    })
    .post('/api/status-pages', requireRole('admin')(async ({ body }: any) => {
      const { name, slug, description, is_public, monitor_ids } = body as {
        name: string;
        slug: string;
        description?: string;
        is_public: boolean;
        monitor_ids: number[];
      };

      if (!name || !slug) {
        return new Response(JSON.stringify({ error: 'Name and slug are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!monitor_ids || monitor_ids.length === 0) {
        return new Response(JSON.stringify({ error: 'At least one monitor must be selected' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if slug already exists
      const existingPage = db.query('SELECT id FROM status_pages WHERE slug = ?').get(slug) as any;
      if (existingPage) {
        return new Response(JSON.stringify({ error: 'Slug already exists' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        const result = db.run(
          'INSERT INTO status_pages (name, slug, description, is_public, monitor_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [name, slug, description || null, is_public ? 1 : 0, JSON.stringify(monitor_ids)]
        );

        const newPage = db.query('SELECT * FROM status_pages WHERE id = ?').get(result.lastInsertRowid) as any;
        
        logger.info(`Created status page "${name}" with slug "${slug}"`, 'STATUS_PAGES');

        return {
          ...newPage,
          is_public: Boolean(newPage.is_public),
          monitor_ids: JSON.parse(newPage.monitor_ids)
        };
      } catch (error) {
        logger.error(`Failed to create status page: ${error}`, 'STATUS_PAGES');
        return new Response(JSON.stringify({ error: 'Failed to create status page' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }))
    .put('/api/status-pages/:id', requireRole('admin')(async ({ params, body }: any) => {
      const { id } = params;
      const { name, slug, description, is_public, monitor_ids } = body as {
        name: string;
        slug: string;
        description?: string;
        is_public: boolean;
        monitor_ids: number[];
      };

      if (!name || !slug) {
        return new Response(JSON.stringify({ error: 'Name and slug are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!monitor_ids || monitor_ids.length === 0) {
        return new Response(JSON.stringify({ error: 'At least one monitor must be selected' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if page exists
      const existingPage = db.query('SELECT * FROM status_pages WHERE id = ?').get(id) as any;
      if (!existingPage) {
        return new Response(JSON.stringify({ error: 'Status page not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if slug already exists (but allow the same slug if it's the current page)
      const slugExists = db.query('SELECT id FROM status_pages WHERE slug = ? AND id != ?').get(slug, id) as any;
      if (slugExists) {
        return new Response(JSON.stringify({ error: 'Slug already exists' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        db.run(
          'UPDATE status_pages SET name = ?, slug = ?, description = ?, is_public = ?, monitor_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [name, slug, description || null, is_public ? 1 : 0, JSON.stringify(monitor_ids), id]
        );

        const updatedPage = db.query('SELECT * FROM status_pages WHERE id = ?').get(id) as any;
        
        logger.info(`Updated status page "${name}" (ID: ${id})`, 'STATUS_PAGES');

        return {
          ...updatedPage,
          is_public: Boolean(updatedPage.is_public),
          monitor_ids: JSON.parse(updatedPage.monitor_ids)
        };
      } catch (error) {
        logger.error(`Failed to update status page: ${error}`, 'STATUS_PAGES');
        return new Response(JSON.stringify({ error: 'Failed to update status page' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }))
    .delete('/api/status-pages/:id', requireRole('admin')(async ({ params }: any) => {
      const { id } = params;

      // Check if page exists
      const existingPage = db.query('SELECT name FROM status_pages WHERE id = ?').get(id) as any;
      if (!existingPage) {
        return new Response(JSON.stringify({ error: 'Status page not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        db.run('DELETE FROM status_pages WHERE id = ?', [id]);
        
        logger.info(`Deleted status page "${existingPage.name}" (ID: ${id})`, 'STATUS_PAGES');

        return { success: true };
      } catch (error) {
        logger.error(`Failed to delete status page: ${error}`, 'STATUS_PAGES');
        return new Response(JSON.stringify({ error: 'Failed to delete status page' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }))
    .get('/api/logs', async () => {
      const logs = db.query('SELECT * FROM application_logs ORDER BY timestamp DESC LIMIT 1000').all() as any[];
      return logs;
    })
    .delete('/api/logs', async () => {
      db.run('DELETE FROM application_logs');
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
      try {
        // Get database file size
        const dbFile = Bun.file(DB_PATH);
        const dbSizeBytes = await dbFile.size;
        const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);
        
        // Get table information
        const tables = db.query(`
          SELECT name 
          FROM sqlite_master 
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `).all() as any[];

        const tableStats = tables.map(table => {
          try {
            // Get row count for each table
            const rowCount = db.query(`SELECT COUNT(*) as count FROM "${table.name}"`).get() as any;
            
            // Calculate approximate table size (this is an estimation)
            // SQLite doesn't provide exact table sizes easily, so we estimate based on page count
            const tableInfo = db.query(`PRAGMA table_info("${table.name}")`).all() as any[];
            const avgRowSize = tableInfo.length * 50; // Rough estimate: 50 bytes per column
            const estimatedSizeBytes = rowCount.count * avgRowSize;
            const estimatedSizeKB = (estimatedSizeBytes / 1024).toFixed(2);
            const estimatedSizeKBNum = parseFloat(estimatedSizeKB);
            
            return {
              name: table.name,
              rows: rowCount.count,
              size: estimatedSizeKBNum < 1024 ? `${estimatedSizeKB} KB` : `${(estimatedSizeBytes / (1024 * 1024)).toFixed(2)} MB`
            };
          } catch (err) {
            // If there's an error querying a specific table, return minimal info
            return {
              name: table.name,
              rows: 0,
              size: '0 KB'
            };
          }
        });

        const dbSizeMBNum = parseFloat(dbSizeMB);
        return {
          size: dbSizeMBNum < 1024 ? `${dbSizeMB} MB` : `${(dbSizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`,
          tables: tableStats
        };
      } catch (error) {
        logger.error(`Error getting database stats: ${error}`, 'DATABASE');
        return {
          size: 'Unknown',
          tables: []
        };
      }
    })
    .post('/api/database/vacuum', async () => {
      try {
        // Run VACUUM command to optimize database
        db.exec('VACUUM');
        logger.info('Database vacuum completed successfully', 'DATABASE');
        return { success: true, message: 'Database vacuum completed successfully' };
      } catch (error) {
        logger.error(`Database vacuum failed: ${error}`, 'DATABASE');
        throw new Error(`Database vacuum failed: ${error}`);
      }
    })
    // Public status page endpoint
    .get('/api/status/:slug', async ({ params }) => {
      const { slug } = params;

      // Get status page
      const statusPage = db.query('SELECT * FROM status_pages WHERE slug = ? AND is_public = 1').get(slug) as any;
      if (!statusPage) {
        return new Response(JSON.stringify({ error: 'Status page not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get monitors for this status page
      const monitorIds = JSON.parse(statusPage.monitor_ids);
      const monitors = await Promise.all(
        monitorIds.map(async (id: number) => {
          const endpoint = db.query('SELECT * FROM endpoints WHERE id = ?').get(id) as any;
          if (!endpoint) return null;

          // Get recent stats for public display
          const stats24h = await calculateGapAwareUptime(db, endpoint.id, endpoint.heartbeat_interval || 60, '1 day');
          const stats30d = await calculateGapAwareUptime(db, endpoint.id, endpoint.heartbeat_interval || 60, '30 days');

          return {
            id: endpoint.id,
            name: endpoint.name,
            url: endpoint.url,
            status: endpoint.status,
            uptime_24h: stats24h?.uptime || 0,
            uptime_30d: stats30d?.uptime || 0,
            last_checked: endpoint.last_checked
          };
        })
      );

      return {
        ...statusPage,
        is_public: Boolean(statusPage.is_public),
        monitor_ids: monitorIds,
        monitors: monitors.filter(m => m !== null)
      };
    })
    .get('/*', async ({ request, set }) => {
      const url = new URL(request.url);
      const assetPath = url.pathname === '/' ? 'index.html' : url.pathname.substring(1);
      const filePath = path.join(import.meta.dir, '..', 'frontend', 'dist', assetPath);

      const file = Bun.file(filePath);
      
      if (await file.exists()) {
        try {
          const stats = await stat(filePath);
          const lastModified = stats.mtime.toUTCString();
          const etag = `"${createHash('md5').update(`${stats.size}-${stats.mtime.getTime()}`).digest('hex')}"`;
          
          // Check if client has cached version (304 Not Modified)
          const ifNoneMatch = request.headers.get('if-none-match');
          const ifModifiedSince = request.headers.get('if-modified-since');
          
          if (ifNoneMatch === etag || ifModifiedSince === lastModified) {
            set.status = 304;
            return new Response(null, { status: 304 });
          }
          
          // Determine file type and set appropriate cache headers and Content-Type
          const ext = path.extname(filePath).toLowerCase();
          let cacheControl: string;
          let contentType: string;
          
          // Set Content-Type based on file extension
          switch (ext) {
            case '.html':
              contentType = 'text/html; charset=utf-8';
              break;
            case '.css':
              contentType = 'text/css; charset=utf-8';
              break;
            case '.js':
              contentType = 'application/javascript; charset=utf-8';
              break;
            case '.json':
              contentType = 'application/json; charset=utf-8';
              break;
            case '.png':
              contentType = 'image/png';
              break;
            case '.jpg':
            case '.jpeg':
              contentType = 'image/jpeg';
              break;
            case '.gif':
              contentType = 'image/gif';
              break;
            case '.svg':
              contentType = 'image/svg+xml; charset=utf-8';
              break;
            case '.ico':
              contentType = 'image/x-icon';
              break;
            case '.webp':
              contentType = 'image/webp';
              break;
            case '.woff':
              contentType = 'font/woff';
              break;
            case '.woff2':
              contentType = 'font/woff2';
              break;
            case '.ttf':
              contentType = 'font/ttf';
              break;
            case '.eot':
              contentType = 'application/vnd.ms-fontobject';
              break;
            case '.xml':
              contentType = 'application/xml; charset=utf-8';
              break;
            case '.txt':
              contentType = 'text/plain; charset=utf-8';
              break;
            default:
              contentType = 'application/octet-stream';
          }
          
          if (['.js', '.css', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
            // Long cache for hashed assets (1 year)
            cacheControl = 'public, max-age=31536000, immutable';
          } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'].includes(ext)) {
            // Medium cache for images (1 week)
            cacheControl = 'public, max-age=604800';
          } else {
            // Short cache for HTML and other files (1 hour)
            cacheControl = 'public, max-age=3600';
          }
          
          // Set security and performance headers
          const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Cache-Control': cacheControl,
            'ETag': etag,
            'Last-Modified': lastModified,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block'
          };
          
          // Add compression for text-based files
          const acceptEncoding = request.headers.get('accept-encoding') || '';
          const isCompressible = ['.js', '.css', '.html', '.json', '.xml', '.txt', '.svg'].includes(ext);
          
          if (isCompressible && acceptEncoding.includes('gzip')) {
            try {
              const fileContent = await file.arrayBuffer();
              const compressed = gzipSync(new Uint8Array(fileContent));
              headers['Content-Encoding'] = 'gzip';
              headers['Content-Length'] = compressed.length.toString();
              
              return new Response(compressed, { headers });
            } catch (compressionError) {
              // Fall back to uncompressed if compression fails
              console.warn('Compression failed, serving uncompressed:', compressionError);
            }
          }
          
          return new Response(file, { headers });
        } catch (error) {
          // If stat fails, serve file without caching headers
          console.warn('Failed to get file stats, serving without optimization:', error);
          return file;
        }
      }

      // Fallback to index.html for SPA routing (with appropriate headers)
      const indexPath = path.join(import.meta.dir, '..', 'frontend', 'dist', 'index.html');
      const indexFile = Bun.file(indexPath);
      
      if (await indexFile.exists()) {
        const headers = {
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block'
        };
        
        return new Response(indexFile, { headers });
      }
      
      // Final fallback - 404
      set.status = 404;
      return new Response('Not Found', { status: 404 });
    })
    .listen(3001);

  console.log(
    `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
  );

  // Store active timers for each endpoint
  const endpointTimers = new Map<number, NodeJS.Timeout>();

  // Function to check a single endpoint
  const checkSingleEndpoint = async (endpoint: Endpoint) => {
    // Skip if endpoint is paused
    if (endpoint.paused) {
      logger.debug(`Skipping paused endpoint "${endpoint.name}" (ID: ${endpoint.id})`, 'MONITORING');
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
              const certDetails = await getCertificateExpiry(hostname);
              if (certDetails && certDetails.daysRemaining !== undefined) {
                const daysRemaining = certDetails.daysRemaining;
                if (daysRemaining <= endpoint.cert_expiry_threshold!) {
                  sendNotification(endpoint, `Certificate for ${endpoint.url} is expiring in ${daysRemaining} days.`);
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
        db.run('UPDATE endpoints SET status = ?, failed_attempts = 0, last_checked = CURRENT_TIMESTAMP WHERE id = ?', ['UP', endpoint.id]);
        db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', [endpoint.id, responseTime, 'UP']);
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
        db.run('UPDATE endpoints SET status = ?, failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', ['DOWN', newFailedAttempts, endpoint.id]);
      } else {
        logger.warn(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) check failed (attempt ${newFailedAttempts}/${endpoint.retries}). Error: ${error}`, 'MONITORING');
        db.run('UPDATE endpoints SET failed_attempts = ?, last_checked = CURRENT_TIMESTAMP WHERE id = ?', [newFailedAttempts, endpoint.id]);
      }
      db.run('INSERT INTO response_times (endpoint_id, response_time, status) VALUES (?, ?, ?)', [endpoint.id, responseTime, 'DOWN']);
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
      logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) is paused - skipping monitoring`, 'MONITORING');
      return;
    }

    const scheduleCheck = () => {
      const timer = setTimeout(async () => {
        try {
          // Check if endpoint is still not paused before running check
          const currentEndpoint = db.query('SELECT paused FROM endpoints WHERE id = ?').get(endpoint.id) as any;
          if (!currentEndpoint?.paused) {
            await checkSingleEndpoint(endpoint);
          } else {
            logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) was paused - stopping monitoring`, 'MONITORING');
            stopEndpointMonitoring(endpoint.id);
            return;
          }
        } catch (err) {
          logger.error(`Error checking endpoint ${endpoint.id} (${endpoint.name}): ${err}`, 'MONITORING');
        }
        // Schedule the next check
        scheduleCheck();
      }, (endpoint.heartbeat_interval || 60) * 1000);

      endpointTimers.set(endpoint.id, timer);
    };

    // Start the first check immediately, then schedule subsequent checks
    setTimeout(async () => {
      try {
        const currentEndpoint = db.query('SELECT paused FROM endpoints WHERE id = ?').get(endpoint.id) as any;
        if (!currentEndpoint?.paused) {
          await checkSingleEndpoint(endpoint);
        } else {
          logger.debug(`Endpoint "${endpoint.name}" (ID: ${endpoint.id}) was paused - not starting monitoring`, 'MONITORING');
          return;
        }
      } catch (err) {
        logger.error(`Error in initial check for endpoint ${endpoint.id} (${endpoint.name}): ${err}`, 'MONITORING');
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
      logger.debug(`Stopped monitoring for endpoint ID: ${endpointId}`, 'MONITORING');
    }
  };

  // Initialize monitoring for all existing endpoints
  const initializeMonitoring = async () => {
    try {
      const endpoints: Endpoint[] = db.query('SELECT * FROM endpoints').all() as Endpoint[];
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
