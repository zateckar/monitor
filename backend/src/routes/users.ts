import { Elysia, t } from 'elysia';
import { ServiceContainer } from '../services/service-container';
import { createSuccessResponse, createErrorResponse } from '../utils/auth-constants';
import { validateEmail, validateAndSanitizeText, MAX_LENGTHS } from '../utils/validation';

/**
 * Creates user management routes
 * @param services Service container with all required dependencies
 * @returns Elysia route handler for user management
 */
export function createUserRoutes(services: ServiceContainer) {
  const { db, authService, logger, requireRole } = services;
  return new Elysia({ prefix: '/api/users' })

    // === User Management ===

    /**
     * Get all users
     * @returns Array of user objects
     */
    .get('/', requireRole('admin')(async () => {
      const users = db.query('SELECT id, username, email, role, is_active, created_at, updated_at, last_login FROM users ORDER BY created_at DESC').all() as any[];
      return createSuccessResponse(users);
    }))

    /**
     * Create a new user
     * @param body - User creation data
     * @returns Created user object
     */
    .post('/', requireRole('admin')(async ({ body, set }: any) => {
      const { username, email, password, role } = body;

      if (!username || !password) {
        set.status = 400;
        return createErrorResponse('Username and password are required');
      }

      // Validate and sanitize username
      const usernameValidation = validateAndSanitizeText(username, MAX_LENGTHS.NAME, 'Username');
      if (!usernameValidation.isValid) {
        set.status = 400;
        return createErrorResponse(usernameValidation.error || 'Invalid username');
      }

      // Validate email if provided
      let sanitizedEmail = null;
      if (email) {
        const emailValidation = validateEmail(email);
        if (!emailValidation.isValid) {
          set.status = 400;
          return createErrorResponse(emailValidation.error || 'Invalid email');
        }
        sanitizedEmail = emailValidation.sanitizedValue;
      }

      // Check if username already exists
      const existingUser = db.query('SELECT id FROM users WHERE username = ?').get(usernameValidation.sanitizedValue) as any;
      if (existingUser) {
        set.status = 400;
        return createErrorResponse('Username already exists');
      }

      // Hash password
      const hashedPassword = await authService.hashPassword(password);

      // Create user
      const result = db.run('INSERT INTO users (username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)', [usernameValidation.sanitizedValue, sanitizedEmail, hashedPassword, role || 'user', true]);

      const newUser = db.query('SELECT id, username, email, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid) as any;

      logger.info(`Admin created new user "${usernameValidation.sanitizedValue}" with role "${role}"`, 'AUTH');

      return createSuccessResponse(newUser);
    }), {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        email: t.Optional(t.String()),
        password: t.String({ minLength: 1 }),
        role: t.Optional(t.Union([t.Literal('admin'), t.Literal('user')]))
      })
    })

    /**
     * Update an existing user
     * @param params.id - User ID to update
     * @param body - Updated user data
     * @returns Updated user object
     */
    .put('/:id', requireRole('admin')(async ({ params, body, set }: any) => {
      const { id } = params;
      const { username, email, role, is_active, password } = body;

      // Get current user
      const currentUser = db.query('SELECT * FROM users WHERE id = ?').get(id) as any;
      if (!currentUser) {
        set.status = 404;
        return createErrorResponse('User not found');
      }

      // Validate and sanitize username if provided
      let sanitizedUsername = currentUser.username;
      if (username) {
        const usernameValidation = validateAndSanitizeText(username, MAX_LENGTHS.NAME, 'Username');
        if (!usernameValidation.isValid) {
          set.status = 400;
          return createErrorResponse(usernameValidation.error || 'Invalid username');
        }
        sanitizedUsername = usernameValidation.sanitizedValue;
      }

      // Validate email if provided
      let sanitizedEmail = currentUser.email;
      if (email !== undefined) {
        if (email) {
          const emailValidation = validateEmail(email);
          if (!emailValidation.isValid) {
            set.status = 400;
            return createErrorResponse(emailValidation.error || 'Invalid email');
          }
          sanitizedEmail = emailValidation.sanitizedValue;
        } else {
          sanitizedEmail = null;
        }
      }

      // Update user
      let hashedPassword = currentUser.password_hash;
      if (password) {
        hashedPassword = await authService.hashPassword(password);
      }

      db.run('UPDATE users SET username = ?, email = ?, role = ?, is_active = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        sanitizedUsername,
        sanitizedEmail,
        role || currentUser.role,
        is_active !== undefined ? is_active : currentUser.is_active,
        hashedPassword,
        id
      ]);

      const updatedUser = db.query('SELECT id, username, email, role, is_active, created_at, updated_at FROM users WHERE id = ?').get(id) as any;

      logger.info(`Admin updated user "${currentUser.username}" (ID: ${id})`, 'AUTH');

      return createSuccessResponse(updatedUser);
    }), {
      params: t.Object({
        id: t.String()
      }),
      body: t.Object({
        username: t.Optional(t.String({ minLength: 1 })),
        email: t.Optional(t.String()),
        role: t.Optional(t.Union([t.Literal('admin'), t.Literal('user')])),
        is_active: t.Optional(t.Boolean()),
        password: t.Optional(t.String({ minLength: 1 }))
      })
    })

    /**
     * Delete a user
     * @param params.id - User ID to delete
     * @returns Success confirmation
     */
    .delete('/:id', requireRole('admin')(async ({ params, user, set }: any) => {
      const { id } = params;

      // Prevent deleting yourself
      if (parseInt(id) === user.id) {
        set.status = 400;
        return createErrorResponse('Cannot delete your own account');
      }

      // Get user before deletion
      const userToDelete = db.query('SELECT username FROM users WHERE id = ?').get(id) as any;
      if (!userToDelete) {
        set.status = 404;
        return createErrorResponse('User not found');
      }

      db.run('DELETE FROM users WHERE id = ?', [id]);

      logger.info(`Admin deleted user "${userToDelete.username}" (ID: ${id})`, 'AUTH');

      return createSuccessResponse({ success: true });
    }), {
      params: t.Object({
        id: t.String()
      })
    });
}
