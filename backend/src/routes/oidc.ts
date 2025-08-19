import { Elysia } from 'elysia';
import { serialize as serializeCookie } from 'cookie';
import * as openidClient from 'openid-client';
import { Database } from 'bun:sqlite';
import { OIDCService } from '../services/oidc';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';

export function createOIDCRoutes(
  db: Database,
  oidcService: OIDCService,
  authService: AuthService,
  logger: LoggerService,
  requireRole: (role: 'admin' | 'user') => (handler: any) => any
) {
  return new Elysia({ prefix: '/api' })
    // Public OIDC endpoints
    .get('/auth/oidc/providers', async () => {
      return oidcService.getProviders();
    })
    .get('/auth/oidc/login/:providerId', async ({ params, set }) => {
      const { providerId } = params;
      
      const config = await oidcService.getOIDCConfig(parseInt(providerId));
      if (!config) {
        set.status = 404;
        return { error: 'OIDC provider not found or inactive' };
      }

      // Get provider scopes and redirect URL
      const provider = db.query('SELECT scopes, redirect_base_url FROM oidc_providers WHERE id = ?').get(providerId) as any;
      const scopes = provider?.scopes || 'openid profile email';
      const redirectBaseUrl = provider?.redirect_base_url || 'http://localhost:3001';

      // Generate state and code verifier using the service (this will store them properly)
      const stateInfo = oidcService.generateAuthorizationUrl(parseInt(providerId), redirectBaseUrl, scopes);
      if (!stateInfo) {
        set.status = 500;
        return { error: 'Failed to generate authorization URL' };
      }

      const { state } = stateInfo;
      
      // Get the code verifier that was already generated and stored by the service
      const storedStateData = oidcService.getStoredState(state);
      if (!storedStateData || !storedStateData.code_verifier) {
        set.status = 500;
        return { error: 'Failed to retrieve stored state data' };
      }

      const codeChallenge = await openidClient.calculatePKCECodeChallenge(storedStateData.code_verifier);

      // Generate authorization URL using new v6.x API
      const authUrl = openidClient.buildAuthorizationUrl(config, {
        redirect_uri: `${redirectBaseUrl}/api/auth/oidc/callback/${providerId}`,
        scope: scopes,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      logger.info(`OIDC login initiated for provider ${providerId}`, 'OIDC');

      return { authorization_url: authUrl.href };
    })
    .get('/auth/oidc/callback/:providerId', async ({ params, query, set }) => {
      const { providerId } = params;
      const { code, state, error, error_description } = query as any;

      // Log the incoming callback request for debugging
      await logger.info(`OIDC callback received for provider ${providerId}`, 'OIDC');
      await logger.info(`Callback query params: ${JSON.stringify(query)}`, 'OIDC');

      if (error) {
        logger.error(`OIDC callback error for provider ${providerId}: ${error} - ${error_description}`, 'OIDC');
        set.status = 400;
        return { error: `OIDC authentication failed: ${error_description || error}` };
      }

      if (!code || !state) {
        await logger.error(`Missing required parameters - code: ${!!code}, state: ${!!state}`, 'OIDC');
        set.status = 400;
        return { error: 'Missing authorization code or state parameter' };
      }

      try {
        await logger.info(`Validating state: ${state} for provider: ${providerId}`, 'OIDC');
        
        const stateValidation = await oidcService.validateStateAndGetConfig(state, parseInt(providerId));
        if (!stateValidation) {
          await logger.error(`State validation failed for state: ${state}, provider: ${providerId}`, 'OIDC');
          set.status = 400;
          return { error: 'Invalid or expired state parameter' };
        }

        const { config, codeVerifier } = stateValidation;
        await logger.info(`State validation successful, code verifier length: ${codeVerifier?.length || 0}`, 'OIDC');

        // Get provider for redirect URL
        const provider = db.query('SELECT redirect_base_url FROM oidc_providers WHERE id = ?').get(providerId) as any;
        const redirectBaseUrl = provider?.redirect_base_url || 'http://localhost:3001';
        
        await logger.info(`Using redirect base URL: ${redirectBaseUrl}`, 'OIDC');

        // Exchange authorization code for tokens
        const redirectUri = `${redirectBaseUrl}/api/auth/oidc/callback/${providerId}`;
        const userInfo = await oidcService.handleTokenExchange(config, code, redirectUri, codeVerifier, state);

        // Find or create user
        const user = await oidcService.findOrCreateUser(parseInt(providerId), userInfo);

        // Generate JWT token
        const token = authService.generateToken(user);

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
        await logger.error(`OIDC token exchange failed for provider ${providerId}: ${error}`, 'OIDC');
        if (error instanceof Error) {
          await logger.error(`Token exchange error details: ${error.message}`, 'OIDC');
          await logger.error(`Token exchange error stack: ${error.stack}`, 'OIDC');
        }
        set.status = 400;
        return { error: 'Failed to exchange authorization code for tokens' };
      }
    })
    // Admin OIDC Provider Management
    .get('/admin/oidc-providers', requireRole('admin')(async () => {
      const providers = db.query('SELECT * FROM oidc_providers ORDER BY created_at DESC').all() as any[];
      return providers.map(provider => ({
        ...provider,
        is_active: Boolean(provider.is_active)
      }));
    }))
    .post('/admin/oidc-providers', requireRole('admin')(async ({ request }: any) => {
      let body: any;
      try {
        body = await request.json();
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
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
      const isValid = await oidcService.validateProviderConfig(issuer_url, client_id, client_secret);
      if (!isValid) {
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
    .put('/admin/oidc-providers/:id', requireRole('admin')(async ({ params, request }: any) => {
      const { id } = params;
      
      let body: any;
      try {
        body = await request.json();
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
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
        const isValid = await oidcService.validateProviderConfig(
          issuer_url, 
          client_id || currentProvider.client_id, 
          client_secret || currentProvider.client_secret
        );
        if (!isValid) {
          return new Response(JSON.stringify({ error: 'Invalid issuer URL or unable to discover OIDC configuration' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Update provider
      db.run('UPDATE oidc_providers SET name = ?, issuer_url = ?, client_id = ?, client_secret = ?, scopes = ?, redirect_base_url = ?, is_active = ? WHERE id = ?', [
        name || currentProvider.name,
        issuer_url || currentProvider.issuer_url,
        client_id || currentProvider.client_id,
        client_secret || currentProvider.client_secret,
        scopes || currentProvider.scopes,
        redirect_base_url || currentProvider.redirect_base_url,
        is_active !== undefined ? is_active : currentProvider.is_active,
        id
      ]);

      // Clear cached config if configuration changed
      if (issuer_url !== undefined || client_id !== undefined || client_secret !== undefined || redirect_base_url !== undefined) {
        oidcService.clearConfigCache(parseInt(id));
      }

      const updatedProvider = db.query('SELECT * FROM oidc_providers WHERE id = ?').get(id) as any;

      logger.info(`Admin updated OIDC provider "${currentProvider.name}" (ID: ${id})`, 'OIDC');

      return {
        ...updatedProvider,
        is_active: Boolean(updatedProvider.is_active)
      };
    }))
    .delete('/admin/oidc-providers/:id', requireRole('admin')(async ({ params }: any) => {
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

      // Clear cached config
      oidcService.clearConfigCache(parseInt(id));

      logger.info(`Admin deleted OIDC provider "${provider.name}" (ID: ${id})`, 'OIDC');

      return { success: true };
    }));
}
