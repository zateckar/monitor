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

// Environment-aware cookie configuration
const isProduction = process.env.NODE_ENV === 'production';

// DRY helper for creating auth cookies
const createAuthCookie = (token: string, maxAge?: number): string => {
  return serializeCookie('auth_token', token, {
    httpOnly: true,
    secure: isProduction, // true in production, false in development
    sameSite: 'lax',
    maxAge: maxAge ?? 7 * 24 * 60 * 60, // Default 7 days
    path: '/'
  });
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

      // Generate 7-day token
      const token = authService.generateToken(user);

      // Set HTTP-only cookie
      const authCookie = createAuthCookie(token);

      set.headers['Set-Cookie'] = authCookie;

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
    }, {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 })
      })
    })
    .post('/logout', async ({ set }) => {
      // Clear cookie
      const clearCookie = createAuthCookie('', 0);

      set.headers['Set-Cookie'] = clearCookie;

      return { success: true };
    })
    .get('/me', async ({ request, set }) => {
      const user = await authService.authenticateUser(request);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if token should be renewed
      const cookieHeader = request.headers.get('cookie');
      let currentToken = null;
      
      if (cookieHeader) {
        const cookies: Record<string, string> = {};
        cookieHeader.split(';').forEach(cookie => {
          const [name, ...rest] = cookie.trim().split('=');
          if (name && rest.length > 0) {
            cookies[name] = rest.join('=');
          }
        });
        currentToken = cookies.auth_token || null;
      }

      if (currentToken) {
        const decoded = authService.verifyToken(currentToken);
        if (decoded && authService.shouldRenewToken(decoded)) {
          // Generate new token and set new cookie
          const newToken = authService.generateToken(user);
          
          const authCookie = createAuthCookie(newToken);

          set.headers['Set-Cookie'] = authCookie;
          
          logger.info(`Token renewed for user "${user.username}"`, 'AUTH');
        }
      }

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        last_login: user.last_login
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
