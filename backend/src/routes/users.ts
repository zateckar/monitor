import { Elysia } from 'elysia';
import { Database } from 'bun:sqlite';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';

export function createUserRoutes(
  db: Database,
  authService: AuthService,
  logger: LoggerService,
  requireRole: (role: 'admin' | 'user') => (handler: any) => any
) {
  return new Elysia({ prefix: '/api/admin' })
    .get('/users', requireRole('admin')(async () => {
      const users = db.query('SELECT id, username, email, role, is_active, created_at, updated_at, last_login FROM users ORDER BY created_at DESC').all() as any[];
      return users;
    }))
    .post('/users', requireRole('admin')(async ({ request }: any) => {
      let body: any;
      try {
        body = await request.json();
        console.log('POST /users - parsed body:', body);
      } catch (error) {
        console.log('POST /users - JSON parse error:', error);
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (!body || typeof body !== 'object') {
        return new Response(JSON.stringify({ error: 'Invalid request body - body is not an object', received: body }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
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
      const hashedPassword = await authService.hashPassword(password);

      // Create user
      const result = db.run('INSERT INTO users (username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)', [username, email || null, hashedPassword, role || 'user', true]);

      const newUser = db.query('SELECT id, username, email, role, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid) as any;

      logger.info(`Admin created new user "${username}" with role "${role}"`, 'AUTH');

      return newUser;
    }))
    .put('/users/:id', requireRole('admin')(async ({ params, request }: any) => {
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
        hashedPassword = await authService.hashPassword(password);
      }

      db.run('UPDATE users SET username = ?, email = ?, role = ?, is_active = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        username || currentUser.username,
        email || currentUser.email,
        role || currentUser.role,
        is_active !== undefined ? is_active : currentUser.is_active,
        hashedPassword,
        id
      ]);

      const updatedUser = db.query('SELECT id, username, email, role, is_active, created_at, updated_at FROM users WHERE id = ?').get(id) as any;

      logger.info(`Admin updated user "${currentUser.username}" (ID: ${id})`, 'AUTH');

      return updatedUser;
    }))
    .delete('/users/:id', requireRole('admin')(async ({ params, user }: any) => {
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
    }));
}
