import { Elysia, t } from 'elysia';
import { serialize as serializeCookie } from 'cookie';
import type { User } from '../types';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';

export function createAuthRoutes(authService: AuthService, logger: LoggerService) {
  return new Elysia({ prefix: '/api/auth' })
    .post('/login', async ({ body, set }) => {
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
