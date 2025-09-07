import { Elysia, t } from 'elysia';
import type { User } from '../types';
import { ServiceContainer } from '../services/service-container';
import { createAuthCookie } from '../utils/cookies';
import { AUTH_LEVELS, createSuccessResponse, createErrorResponse, API_VERSIONS } from '../utils/auth-constants';
import { RouteMetadataRegistry, RouteMeta } from '../utils/route-metadata';
import { Errors, HTTP_STATUS } from '../utils/error-handler';
import { VersionUtils } from '../utils/api-versioning';

/**
 * Creates authentication routes with standardized patterns
 * @param services Service container with all required dependencies
 * @returns Elysia route handler for authentication
 */
export function createAuthRoutes(services: ServiceContainer) {
   const { authService, logger } = services;
   const registry = RouteMetadataRegistry.getInstance();

   return new Elysia({ prefix: '/api/auth' })
     // === Authentication Routes ===

     /**
      * Authenticate user and generate JWT token
      * @param body.username - User's username
      * @param body.password - User's password
      * @returns User data and JWT token
      */
     .post('/login', async ({ body, set, request }) => {
      try {
        const { username, password } = body;

        // Get user from database
        const user = authService.getUserByUsername(username);

        if (!user || !user.password_hash) {
          throw Errors.authentication('Invalid credentials');
        }

        // Verify password
        const passwordValid = await authService.verifyPassword(password, user.password_hash);
        if (!passwordValid) {
          throw Errors.authentication('Invalid credentials');
        }

        // Update last login
        authService.updateUserLastLogin(user.id);

        // Generate 7-day token
        const token = authService.generateToken(user);

        // Set HTTP-only cookie
        const authCookie = createAuthCookie(token);
        set.headers['Set-Cookie'] = authCookie;

        logger.info(`User "${username}" logged in successfully`, 'AUTH');

        // Register route metadata
        registry.register('/login', RouteMeta.public('User login', ['auth', 'login']));

        return createSuccessResponse({
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            created_at: user.created_at
          },
          token
        });
      } catch (error: any) {
        logger.error(`Login failed for user "${body.username}": ${error.message}`, 'AUTH');
        throw error; // Let global error handler deal with it
      }
    }, {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 })
      })
    })
    /**
     * Logout user by clearing authentication cookie
     * @returns Success confirmation
     */
    .post('/logout', async ({ set }) => {
      try {
        // Clear cookie
        const clearCookie = createAuthCookie('', 0);
        set.headers['Set-Cookie'] = clearCookie;

        logger.info('User logged out', 'AUTH');

        // Register route metadata
        registry.register('/logout', RouteMeta.user('User logout', ['auth', 'logout']));

        return createSuccessResponse(null, 'Logged out successfully');
      } catch (error: any) {
        logger.error(`Logout failed: ${error.message}`, 'AUTH');
        throw error;
      }
    })
    /**
     * Get current authenticated user information
     * @returns Current user profile data
     */
    .get('/me', async ({ request, set }) => {
      try {
        const user = await authService.authenticateUser(request);
        if (!user) {
          throw Errors.authentication('Authentication required');
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

        // Register route metadata
        registry.register('/me', RouteMeta.user('Get current user info', ['auth', 'profile']));

        return createSuccessResponse({
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          created_at: user.created_at,
          last_login: user.last_login
        });
      } catch (error: any) {
        logger.error(`Failed to get user info: ${error.message}`, 'AUTH');
        throw error;
      }
    });
}

/**
 * Creates authentication middleware
 * @param services Service container with all required dependencies
 * @returns Authentication middleware functions
 */
export function createAuthMiddleware(services: ServiceContainer) {
  const { authService, logger } = services;

  return {
    requireAuth: (handler: any) => {
      return async (context: any) => {
        const user = await authService.authenticateUser(context.request);
        if (!user) {
          context.set.status = 401;
          return createErrorResponse('Authentication required');
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
            logger.warn(`Authentication failed for ${context.request.method} ${context.request.url}`, 'AUTH');
            context.set.status = 401;
            return createErrorResponse('Authentication required');
          }

          const isAllowed = (userRole: string, requiredRole: string) => {
            if (requiredRole === 'admin') {
              return userRole === 'admin';
            }
            if (requiredRole === 'user') {
              return userRole === 'user' || userRole === 'admin';
            }
            return false;
          };

          if (!isAllowed(user.role, role)) {
            logger.warn(`Access denied for user "${user.username}" with role "${user.role}" for required role "${role}"`, 'AUTH');
            context.set.status = 403;
            return createErrorResponse('Insufficient permissions');
          }

          context.user = user;
          return handler(context);
        };
      };
    }
  };
}
