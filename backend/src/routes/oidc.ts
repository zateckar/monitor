import { Elysia } from 'elysia';
import { serialize as serializeCookie, parse as parseCookie } from 'cookie';
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
      
      // Get provider scopes and redirect URL
      const provider = db.query('SELECT scopes, redirect_base_url FROM oidc_providers WHERE id = ? AND is_active = 1').get(providerId) as any;
      if (!provider) {
        set.status = 404;
        return { error: 'OIDC provider not found or inactive' };
      }

      const scopes = provider.scopes || 'openid profile email';
      const redirectBaseUrl = provider.redirect_base_url || 'http://localhost:3001';

      // Generate authorization URL using the new stateless method following reference implementation
      const authResult = await oidcService.generateAuthorizationUrl(parseInt(providerId), redirectBaseUrl, scopes);
      if (!authResult) {
        set.status = 500;
        return { error: 'Failed to generate authorization URL' };
      }

      // Store session data in cookies (following reference implementation pattern)
      const sessionData = {
        provider_id: parseInt(providerId),
        code_verifier: authResult.code_verifier,
        nonce: authResult.nonce,
        expires_at: Date.now() + 10 * 60 * 1000 // 10 minutes
      };

      const sessionCookie = serializeCookie('oidc_session', JSON.stringify(sessionData), {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        sameSite: 'lax',
        maxAge: 10 * 60, // 10 minutes
        path: '/'
      });

      set.headers['Set-Cookie'] = sessionCookie;

      logger.info(`OIDC login initiated for provider ${providerId} with PKCE (no state parameter, following reference implementation)`, 'OIDC');

      return { authorization_url: authResult.authUrl };
    })
    .get('/auth/oidc/callback/:providerId', async ({ params, query, set, request }) => {
      const { providerId } = params;
      const { code, error, error_description } = query as any;

      // Log the incoming callback request for debugging
      await logger.info(`OIDC callback received for provider ${providerId}`, 'OIDC');
      await logger.info(`Callback query params: ${JSON.stringify(query)}`, 'OIDC');

      if (error) {
        logger.error(`OIDC callback error for provider ${providerId}: ${error} - ${error_description}`, 'OIDC');
        set.status = 400;
        return { error: `OIDC authentication failed: ${error_description || error}` };
      }

      if (!code) {
        await logger.error(`Missing required parameter - code: ${!!code}`, 'OIDC');
        set.status = 400;
        return { error: 'Missing authorization code parameter' };
      }

      try {
        // Retrieve session data from cookies (following reference implementation pattern)
        const cookies = parseCookie(request.headers.get('cookie') || '');
        const oidcSessionCookie = cookies.oidc_session;
        
        if (!oidcSessionCookie) {
          await logger.error(`No OIDC session found for provider ${providerId}`, 'OIDC');
          set.status = 400;
          return { error: 'No OIDC session found. Please restart the authentication process.' };
        }

        let sessionData;
        try {
          sessionData = JSON.parse(oidcSessionCookie);
        } catch (e) {
          await logger.error(`Invalid OIDC session data for provider ${providerId}`, 'OIDC');
          set.status = 400;
          return { error: 'Invalid session data. Please restart the authentication process.' };
        }

        // Validate session data
        if (sessionData.provider_id !== parseInt(providerId)) {
          await logger.error(`Provider mismatch in session data: expected ${providerId}, got ${sessionData.provider_id}`, 'OIDC');
          set.status = 400;
          return { error: 'Provider mismatch in session data' };
        }

        if (sessionData.expires_at < Date.now()) {
          await logger.error(`Expired session for provider ${providerId}`, 'OIDC');
          set.status = 400;
          return { error: 'Session expired. Please restart the authentication process.' };
        }

        // Get OIDC configuration
        const config = await oidcService.getOIDCConfig(parseInt(providerId));
        if (!config) {
          await logger.error(`Failed to get OIDC config for provider ${providerId}`, 'OIDC');
          set.status = 500;
          return { error: 'Failed to get OIDC configuration' };
        }

        await logger.info(`Session validation successful for provider ${providerId}`, 'OIDC');
        await logger.info(`Code verifier: present, Nonce: ${sessionData.nonce ? 'present' : 'absent'}`, 'OIDC');

        // Perform token exchange using the session data (following reference implementation exactly)
        await logger.info(`Using callback URL: ${request.url}`, 'OIDC');
        const userInfo = await oidcService.handleTokenExchange(
          config, 
          request.url, 
          sessionData.code_verifier, 
          sessionData.nonce
        );

        // Find or create user
        const user = await oidcService.findOrCreateUser(parseInt(providerId), userInfo);

        // Generate JWT token
        const token = authService.generateToken(user);

        // Set HTTP-only cookie for web clients and clear session cookie
        const authCookie = serializeCookie('auth_token', token, {
          httpOnly: true,
          secure: false, // Set to true in production with HTTPS
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60, // 7 days
          path: '/'
        });

        const clearSessionCookie = serializeCookie('oidc_session', '', {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          maxAge: 0, // Clear the cookie
          path: '/'
        });

        set.headers['Set-Cookie'] = authCookie;

        logger.info(`User "${user.username}" logged in successfully via OIDC provider ${providerId}`, 'OIDC');

        // Redirect to frontend
        set.status = 302;
        set.headers['Location'] = '/?oidc_login=success';
        
        // Clear the session cookie by setting it with an expired date
        const response = new Response(null, { 
          status: 302, 
          headers: {
            'Location': '/?oidc_login=success',
            'Set-Cookie': authCookie
          }
        });
        
        // Add the clear session cookie header
        response.headers.append('Set-Cookie', clearSessionCookie);
        
        return response;
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
      
      const { name, issuer_url, client_id, client_secret, scopes, redirect_base_url, use_pkce } = body as {
        name: string;
        issuer_url: string;
        client_id: string;
        client_secret: string;
        scopes?: string;
        redirect_base_url?: string;
        use_pkce?: boolean;
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

      const result = db.run('INSERT INTO oidc_providers (name, issuer_url, client_id, client_secret, scopes, redirect_base_url, use_pkce, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [name, issuer_url, client_id, client_secret, scopes || 'openid profile email', redirect_base_url || 'http://localhost:3001', use_pkce !== false, true]);

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
      
      const { name, issuer_url, client_id, client_secret, scopes, redirect_base_url, use_pkce, is_active } = body as {
        name?: string;
        issuer_url?: string;
        client_id?: string;
        client_secret?: string;
        scopes?: string;
        redirect_base_url?: string;
        use_pkce?: boolean;
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
      db.run('UPDATE oidc_providers SET name = ?, issuer_url = ?, client_id = ?, client_secret = ?, scopes = ?, redirect_base_url = ?, use_pkce = ?, is_active = ? WHERE id = ?', [
        name || currentProvider.name,
        issuer_url || currentProvider.issuer_url,
        client_id || currentProvider.client_id,
        client_secret || currentProvider.client_secret,
        scopes || currentProvider.scopes,
        redirect_base_url || currentProvider.redirect_base_url,
        use_pkce !== undefined ? use_pkce : currentProvider.use_pkce,
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
