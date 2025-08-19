import { Database } from 'bun:sqlite';
import * as openidClient from 'openid-client';
import type { OIDCProvider } from '../types';
import { LoggerService } from './logger';

export class OIDCService {
  private oidcConfigs = new Map<number, any>();
  private oidcStates = new Map<string, { provider_id: number, expires_at: number, code_verifier?: string }>();

  constructor(private db: Database, private logger: LoggerService) {
    // Clean up expired states every 5 minutes
    setInterval(() => this.cleanupExpiredStates(), 5 * 60 * 1000);
  }

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

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, data] of this.oidcStates.entries()) {
      if (data.expires_at < now) {
        this.oidcStates.delete(state);
      }
    }
  }

  generateAuthorizationUrl(providerId: number, redirectBaseUrl: string, scopes: string): { authUrl: string, state: string } | null {
    // Generate state and code verifier for PKCE
    const state = openidClient.randomNonce();
    const codeVerifier = openidClient.randomPKCECodeVerifier();

    // Store state and code verifier with expiration (10 minutes)
    this.oidcStates.set(state, {
      provider_id: providerId,
      expires_at: Date.now() + 10 * 60 * 1000,
      code_verifier: codeVerifier
    });

    return { authUrl: '', state }; // Will be populated by caller
  }

  updateStateWithCodeVerifier(state: string, codeVerifier: string): void {
    const stateData = this.oidcStates.get(state);
    if (stateData) {
      stateData.code_verifier = codeVerifier;
      this.oidcStates.set(state, stateData);
    }
  }

  getStoredState(state: string): { provider_id: number, expires_at: number, code_verifier?: string } | undefined {
    return this.oidcStates.get(state);
  }

  async validateStateAndGetConfig(state: string, providerId: number): Promise<{ config: any, codeVerifier: string } | null> {
    // Verify state
    const stateData = this.oidcStates.get(state);
    if (!stateData || stateData.provider_id !== providerId) {
      return null;
    }

    // Remove used state
    this.oidcStates.delete(state);

    if (stateData.expires_at < Date.now()) {
      return null;
    }

    const config = await this.getOIDCConfig(providerId);
    if (!config) {
      return null;
    }

    return {
      config,
      codeVerifier: stateData.code_verifier!
    };
  }

  async handleTokenExchange(config: any, code: string, redirectUri: string, codeVerifier: string): Promise<any> {
    try {
      // Log the token exchange attempt for debugging
      await this.logger.info(`Attempting token exchange with redirect URI: ${redirectUri}`, 'OIDC');
      await this.logger.info(`Using code verifier length: ${codeVerifier?.length || 0}`, 'OIDC');
      await this.logger.info(`Authorization code: ${code}`, 'OIDC');

      // Exchange authorization code for tokens using new v6.x API
      // Create the callback URL with the authorization code
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('code', code);
      
      const tokenSet = await openidClient.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: codeVerifier,
      });

      await this.logger.info(`Token exchange successful, received token set`, 'OIDC');

      // Get user info from the ID token
      const claims = tokenSet.claims();
      if (!claims) {
        throw new Error('No claims found in ID token');
      }

      let userInfo: any = claims;

      // If we have an access token, try to get additional user info
      if (tokenSet.access_token && claims.sub) {
        try {
          const additionalUserInfo = await openidClient.fetchUserInfo(config, tokenSet.access_token, claims.sub);
          userInfo = { ...claims, ...additionalUserInfo };
        } catch (err) {
          await this.logger.warn(`Failed to fetch additional user info: ${err}`, 'OIDC');
        }
      }

      return userInfo;
    } catch (error) {
      // Enhanced error logging
      await this.logger.error(`Token exchange failed with detailed error: ${error}`, 'OIDC');
      if (error instanceof Error) {
        await this.logger.error(`Error message: ${error.message}`, 'OIDC');
        await this.logger.error(`Error stack: ${error.stack}`, 'OIDC');
      }
      
      // Re-throw the error to be caught by the route handler
      throw error;
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
