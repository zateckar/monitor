import { Database } from 'bun:sqlite';
import * as openidClient from 'openid-client';
import type { OIDCProvider } from '../types';
import { LoggerService } from './logger';

interface UserClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  nonce?: string;
  [key: string]: any;
}

interface TokenExchangeResult {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  [key: string]: any;
}

// Constants for better maintainability
const TOKEN_EXCHANGE_CONTEXT = 'OIDC-TokenExchange';
const ERRORS = {
  NO_CLAIMS: 'No claims found in ID token',
  NONCE_MISMATCH: 'ID token nonce validation failed - potential replay attack',
  INVALID_URL: 'Invalid URL provided for token exchange'
} as const;

export class OIDCService {
  private oidcConfigs = new Map<number, any>();

  constructor(private db: Database, private logger: LoggerService) {}

  async getOIDCConfig(providerId: number): Promise<any | null> {
    // Check if we already have a cached config
    if (this.oidcConfigs.has(providerId)) {
      return this.oidcConfigs.get(providerId)!;
    }

    // Get provider from database
    const provider = this.db.query('SELECT * FROM oidc_providers WHERE id = ? AND is_active = 1').get(providerId) as any;
    if (!provider) {
      return null;
    }

    try {
      // Use new v6.x discovery API
      const config = await openidClient.discovery(new URL(provider.issuer_url), provider.client_id, provider.client_secret);

      // Cache the config
      this.oidcConfigs.set(providerId, config);
      
      return config;
    } catch (error) {
      await this.logger.error(`Failed to create OIDC config for provider ${providerId}: ${error}`, 'OIDC');
      return null;
    }
  }

  /**
   * Generates authorization URL following the reference implementation exactly
   */
  async generateAuthorizationUrl(providerId: number, redirectBaseUrl: string, scopes: string): Promise<{ authUrl: string, sessionId: string, code_verifier: string, nonce?: string } | null> {
    try {
      // Get OIDC configuration
      const config = await this.getOIDCConfig(providerId);
      if (!config) {
        return null;
      }

      // Generate PKCE code verifier and challenge
      const code_verifier = openidClient.randomPKCECodeVerifier();
      const code_challenge = await openidClient.calculatePKCECodeChallenge(code_verifier);
      const code_challenge_method = 'S256';
      
      let nonce: string | undefined;

      // Build authorization parameters
      const parameters: Record<string, string> = {
        redirect_uri: `${redirectBaseUrl}/api/auth/oidc/callback/${providerId}`,
        scope: scopes,
        code_challenge,
        code_challenge_method,
      };

      // We cannot be sure the AS supports PKCE so we're going to use nonce too. 
      // Use of PKCE is backwards compatible even if the AS doesn't support it which is 
      // why we're using it regardless.
      if (!config.serverMetadata().supportsPKCE()) {
        nonce = openidClient.randomNonce();
        parameters.nonce = nonce;
      }

      // Generate authorization URL
      const authUrl = openidClient.buildAuthorizationUrl(config, parameters);

      // Generate session ID for storing code_verifier and nonce
      const sessionId = openidClient.randomNonce();

      await this.logger.info(`Generated authorization URL for provider ${providerId} with PKCE`, 'OIDC');

      return { 
        authUrl: authUrl.href, 
        sessionId, 
        code_verifier,
        nonce 
      };
    } catch (error) {
      await this.logger.error(`Failed to generate authorization URL for provider ${providerId}: ${error}`, 'OIDC');
      return null;
    }
  }

  /**
   * Handles the OIDC token exchange process
   */
  async handleTokenExchange(
    config: openidClient.Configuration,
    currentUrl: URL | Request | string,
    code_verifier: string,
    nonce?: string
  ): Promise<TokenExchangeResult> {
    await this.logger.info(`Token exchange initiated: ${currentUrl.toString()}`, TOKEN_EXCHANGE_CONTEXT);
    
    try {
      // Validate input parameters
      if (!config) {
        throw new Error('OIDC configuration is required');
      }
      
      if (!currentUrl) {
        throw new Error(ERRORS.INVALID_URL);
      }
      
      if (!code_verifier) {
        throw new Error('PKCE code verifier is required');
      }
      
      // Normalize URL to proper URL object
      const normalizedUrl = this.normalizeUrl(currentUrl);
      
      // Log token exchange attempt
      await this.logger.info(`Token exchange attempt - URL: ${normalizedUrl.href}, PKCE: enabled, Nonce: ${nonce ? 'present' : 'absent'}`, TOKEN_EXCHANGE_CONTEXT);
      
      // Perform the actual token exchange with PKCE verification
      const tokenSet = await openidClient.authorizationCodeGrant(config, normalizedUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce,
        idTokenExpected: true,
      });
      
      // Extract and validate claims
      const claims = this.extractAndValidateClaims(tokenSet, nonce);
      
      // Fetch additional user information if possible
      const userInfo = await this.fetchCompleteUserInfo(config, tokenSet, claims);
      
      await this.logger.info(`Token exchange completed successfully for subject: ${claims.sub}`, TOKEN_EXCHANGE_CONTEXT);
      
      return userInfo;
    } catch (error) {
      await this.handleTokenExchangeError(error, currentUrl, nonce);
      throw error;
    }
  }

  /**
   * Converts URL input to proper URL object for openid-client, handling reverse proxy scenarios
   */
  private normalizeUrl(currentUrl: URL | Request | string): URL {
    if (currentUrl instanceof URL) {
      return this.ensureProperScheme(currentUrl);
    }
    
    if (typeof currentUrl === 'string') {
      try {
        const url = new URL(currentUrl);
        return this.ensureProperScheme(url);
      } catch {
        throw new Error(`${ERRORS.INVALID_URL}: ${currentUrl}`);
      }
    }
    
    // It's a Request object - need to check for proxy headers
    try {
      const url = new URL(currentUrl.url);
      const correctedUrl = this.ensureProperScheme(url, currentUrl.headers);
      return correctedUrl;
    } catch {
      throw new Error(`${ERRORS.INVALID_URL}: ${currentUrl.url}`);
    }
  }

  /**
   * Ensures the URL has the correct scheme, especially when behind reverse proxies
   */
  private ensureProperScheme(url: URL, headers?: Headers): URL {
    // Check if we're in production and the URL scheme is HTTP
    if (process.env.NODE_ENV === 'production' && url.protocol === 'http:') {
      let correctionReason = 'default production behavior';
      
      // Check for common reverse proxy headers that indicate the original scheme
      if (headers) {
        const forwardedProto = headers.get('x-forwarded-proto');
        const forwardedScheme = headers.get('x-forwarded-scheme');
        const forwardedHeader = headers.get('forwarded');
        
        // Check X-Forwarded-Proto header (most common)
        if (forwardedProto === 'https') {
          correctionReason = 'X-Forwarded-Proto header';
        }
        // Check X-Forwarded-Scheme header
        else if (forwardedScheme === 'https') {
          correctionReason = 'X-Forwarded-Scheme header';
        }
        // Check Forwarded header (RFC 7239)
        else if (forwardedHeader && forwardedHeader.includes('proto=https')) {
          correctionReason = 'Forwarded header';
        }
      }
      
      // Correct the URL scheme to HTTPS
      const originalUrl = url.href;
      url.protocol = 'https:';
      
      // Log the correction asynchronously to avoid blocking
      this.logger.info(`Corrected URL scheme from HTTP to HTTPS (${correctionReason}): ${originalUrl} -> ${url.href}`, TOKEN_EXCHANGE_CONTEXT).catch(() => {
        // Ignore logging errors to prevent them from affecting the main flow
      });
    }
    
    return url;
  }

  /**
   * Extracts and validates claims from the token set
   */
  private extractAndValidateClaims(tokenSet: any, expectedNonce?: string): UserClaims {
    const claims = tokenSet.claims();
    if (!claims) {
      throw new Error(ERRORS.NO_CLAIMS);
    }
    
    // Validate required subject claim
    if (!claims.sub) {
      throw new Error('Missing required "sub" claim in ID token');
    }
    
    // Validate nonce if expected
    if (expectedNonce && claims.nonce !== expectedNonce) {
      throw new Error(ERRORS.NONCE_MISMATCH);
    }
    
    return claims as UserClaims;
  }

  /**
   * Fetches complete user information by combining ID token claims with userinfo endpoint data
   */
  private async fetchCompleteUserInfo(
    config: openidClient.Configuration,
    tokenSet: any,
    claims: UserClaims
  ): Promise<TokenExchangeResult> {
    let userInfo: TokenExchangeResult = { ...claims };
    
    // Attempt to fetch additional user info from userinfo endpoint
    if (tokenSet.access_token && claims.sub) {
      try {
        const additionalUserInfo = await openidClient.fetchUserInfo(config, tokenSet.access_token, claims.sub);
        userInfo = { ...claims, ...additionalUserInfo };
        await this.logger.debug(`Successfully fetched additional user info for subject: ${claims.sub}`, TOKEN_EXCHANGE_CONTEXT);
      } catch (err) {
        // Log as debug since this is not critical for authentication
        await this.logger.debug(`Failed to fetch additional user info: ${err}`, TOKEN_EXCHANGE_CONTEXT);
      }
    }
    
    return userInfo;
  }

  /**
   * Handles and logs token exchange errors with detailed information
   */
  private async handleTokenExchangeError(error: unknown, currentUrl: URL | Request | string, nonce?: string): Promise<void> {
    const urlString = typeof currentUrl === 'string' ? currentUrl : 
                     currentUrl instanceof URL ? currentUrl.href : currentUrl.url;
    
    if (error instanceof Error) {
      const errorDetails = [
        `URL: ${urlString}`,
        `Message: ${error.message}`,
        `Has Nonce: ${!!nonce}`
      ].join(', ');
      
      await this.logger.error(`Token exchange failed - ${errorDetails}`, TOKEN_EXCHANGE_CONTEXT);
      
      // Log stack trace only in development or for specific error types
      if (process.env.NODE_ENV === 'development' || error.message.includes('fetch')) {
        await this.logger.debug(`Stack trace: ${error.stack}`, TOKEN_EXCHANGE_CONTEXT);
      }
    } else {
      await this.logger.error(`Token exchange failed with unknown error: ${error}`, TOKEN_EXCHANGE_CONTEXT);
    }
  }

  async findOrCreateUser(providerId: number, userInfo: any): Promise<any> {
    const subject = userInfo?.sub;
    const email = userInfo?.email;
    const username = userInfo?.preferred_username || userInfo?.name || email || subject;

    if (!subject) {
      throw new Error('No subject (sub) claim found in OIDC response');
    }

    // Check if user already exists
    let user = this.db.query('SELECT * FROM users WHERE oidc_provider_id = ? AND oidc_subject = ? AND is_active = 1').get(providerId, String(subject)) as any;

    if (!user) {
      // Check if user exists with same email
      if (email) {
        const existingEmailUser = this.db.query('SELECT * FROM users WHERE email = ? AND is_active = 1').get(String(email)) as any;
        
        if (existingEmailUser) {
          // Link existing user to OIDC provider
          this.db.run('UPDATE users SET oidc_provider_id = ?, oidc_subject = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [providerId, String(subject), existingEmailUser.id]);
          user = existingEmailUser;
          await this.logger.info(`Linked existing user "${existingEmailUser.username}" to OIDC provider ${providerId}`, 'OIDC');
        }
      }

      if (!user) {
        // Create new user
        const result = this.db.run('INSERT INTO users (username, email, oidc_provider_id, oidc_subject, role, is_active) VALUES (?, ?, ?, ?, ?, ?)', [String(username), email ? String(email) : null, providerId, String(subject), 'user', true]);

        user = this.db.query('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as any;
        await this.logger.info(`Created new OIDC user "${username}" for provider ${providerId}`, 'OIDC');
      }
    }

    // Update last login
    this.db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    return user;
  }

  getProviders(): any[] {
    return this.db.query('SELECT id, name, issuer_url FROM oidc_providers WHERE is_active = 1 ORDER BY name').all() as any[];
  }

  async validateProviderConfig(issuerUrl: string, clientId: string, clientSecret: string): Promise<boolean> {
    try {
      await openidClient.discovery(new URL(issuerUrl), clientId, clientSecret);
      return true;
    } catch (error) {
      return false;
    }
  }

  clearConfigCache(providerId: number): void {
    this.oidcConfigs.delete(providerId);
  }
}
