import { Elysia, t } from 'elysia';
import type { User } from '../types';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';

// Cookie helper function
const serializeCookie = (name: string, value: string, options: {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
  path?: string;
} = {}): string => {
  let cookie = `${name}=${value}`;
  
  if (options.httpOnly) cookie += '; HttpOnly';
  if (options.secure) cookie += '; Secure';
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options.path) cookie += `; Path=${options.path}`;
  
  return cookie;
};

export function createAuthRoutes(authService: AuthService, logger: LoggerService) {
  return new Elysia({ prefix: '/api/auth' })
    .post('/login', async ({ body, set, request }) => {
      const { username, password } = body;

      // Get user from database
      const user = authService.getUserByUsername(username);

      if (!user || !user.password_hash) {
        set.status = 401;
        return { error: 'Invalid credentials' };
      }

      // Verify password
      const passwordValid = await authService.verifyPassword(password, user.password_hash);
      if (!passwordValid) {
        set.status = 401;
        return { error: 'Invalid credentials' };
      }

      // Update last login
      authService.updateUserLastLogin(user.id);

      // Generate access and refresh tokens
      const { accessToken, refreshToken } = authService.generateTokenPair(user);

      // Store refresh token in database
      const userAgent = request.headers.get('user-agent') || undefined;
      const clientIP = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || undefined;
      
      await authService.storeRefreshToken(user.id, refreshToken, userAgent, clientIP);

      // Set HTTP-only cookies for both tokens
      const accessCookie = serializeCookie('auth_token', accessToken, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        sameSite: 'lax',
        maxAge: 15 * 60, // 15 minutes
        path: '/'
      });

      const refreshCookie = serializeCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days
        path: '/'
      });

      // Set both cookies by joining them
      set.headers['Set-Cookie'] = `${accessCookie}, ${refreshCookie}`;

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
        token: accessToken,
        refreshToken
      };
    }, {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 })
      })
    })
  .post('/refresh', async ({ request, set }) => {
      // Get refresh token from cookies
      const cookieHeader = request.headers.get('cookie');
      let refreshToken = null;
      
      if (cookieHeader) {
        const cookies: Record<string, string> = {};
        cookieHeader.split(';').forEach(cookie => {
          const [name, ...rest] = cookie.trim().split('=');
          if (name && rest.length > 0) {
            cookies[name] = rest.join('=');
          }
        });
        refreshToken = cookies.refresh_token || null;
      }

      if (!refreshToken) {
        set.status = 401;
        return { error: 'Refresh token required' };
      }

      // Verify refresh token and get user
      const user = await authService.verifyRefreshToken(refreshToken);
      if (!user) {
        set.status = 401;
        return { error: 'Invalid or expired refresh token' };
      }

      // Record refresh activity
      authService.recordUserActivity(user.id, 'refresh_token');

      // Generate new access token
      const accessToken = authService.generateToken(user);

      // Set new access token cookie
      const accessCookie = serializeCookie('auth_token', accessToken, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        sameSite: 'lax',
        maxAge: 15 * 60, // 15 minutes
        path: '/'
      });

      set.headers['Set-Cookie'] = accessCookie;

      logger.info(`Access token refreshed for user "${user.username}"`, 'AUTH');

      return {
        success: true,
        token: accessToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          created_at: user.created_at
        }
      };
    })
    .post('/logout', async ({ set, request }) => {
      // Get refresh token from cookies to revoke it
      const cookieHeader = request.headers.get('cookie');
      if (cookieHeader) {
        const cookies: Record<string, string> = {};
        cookieHeader.split(';').forEach(cookie => {
          const [name, ...rest] = cookie.trim().split('=');
          if (name && rest.length > 0) {
            cookies[name] = rest.join('=');
          }
        });
        const refreshToken = cookies.refresh_token;
        if (refreshToken) {
          // Find and revoke the refresh token
          const user = await authService.verifyRefreshToken(refreshToken);
          if (user) {
            authService.revokeAllUserRefreshTokens(user.id);
          }
        }
      }

      // Clear both cookies
      const clearAccessCookie = serializeCookie('auth_token', '', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 0,
        path: '/'
      });

      const clearRefreshCookie = serializeCookie('refresh_token', '', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 0,
        path: '/'
      });

      set.headers['Set-Cookie'] = `${clearAccessCookie}, ${clearRefreshCookie}`;

      return { success: true };
    })
    .get('/me', async ({ request }) => {
      const user = await authService.authenticateUser(request);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        last_login: user.last_login
      };
    })
    .post('/activity', async ({ request }) => {
      const user = await authService.authenticateUser(request);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Record user activity
      authService.recordUserActivity(user.id, 'api_call');

      return { success: true };
    })
    .get('/activity', async ({ request }) => {
      const user = await authService.authenticateUser(request);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get user activity information
      const activity = authService.getUserActivity(user.id);

      return {
        lastActivity: activity.lastActivity,
        isActiveWithinWeek: activity.isActiveWithinWeek
      };
    });
}

// Middleware factory for authentication
export function createAuthMiddleware(authService: AuthService) {
  return {
    requireAuth: (handler: any) => {
      return async (context: any) => {
        const user = await authService.authenticateUser(context.request);
        if (!user) {
          return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        context.user = user;
        return handler(context);
      };
    },

    requireRole: (role: 'admin' | 'user') => {
      return (handler: any) => {
        return async (context: any) => {
          const user = await authService.authenticateUser(context.request);
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
    }
  };
}
