import jwt from 'jsonwebtoken';
import { Database } from 'bun:sqlite';
import type { User } from '../types';
import { JWT_SECRET, JWT_EXPIRES_IN, TOKEN_RENEWAL_THRESHOLD } from '../config/constants';

export class AuthService {
  constructor(private db: Database) {}

  async hashPassword(password: string): Promise<string> {
    return await Bun.password.hash(password, { algorithm: "bcrypt", cost: 4});
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await Bun.password.verify(password, hash);
  }

  generateToken(user: User): string {
    return jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role,
        email: user.email,
        issuedAt: Date.now() // Add timestamp for renewal logic
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
  }

  verifyToken(token: string): any {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if token should be renewed (issued more than 24 hours ago)
   */
  shouldRenewToken(decoded: any): boolean {
    if (!decoded.issuedAt) return false;
    
    const tokenAge = Date.now() - decoded.issuedAt;
    return tokenAge > TOKEN_RENEWAL_THRESHOLD;
  }

  async authenticateUser(request: Request): Promise<User | null> {
    // Try to get token from Authorization header
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    // If no token in header, try cookies
    if (!token) {
      const cookieHeader = request.headers.get('cookie');
      if (cookieHeader) {
        // Simple cookie parsing for auth_token
        const cookies: Record<string, string> = {};
        cookieHeader.split(';').forEach(cookie => {
          const [name, ...rest] = cookie.trim().split('=');
          if (name && rest.length > 0) {
            cookies[name] = rest.join('=');
          }
        });
        token = cookies.auth_token || null;
      }
    }

    if (!token) {
      return null;
    }

    const decoded = this.verifyToken(token);
    if (!decoded) {
      return null;
    }

    // Get user from database to ensure they still exist and are active
    const user = this.db.query('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.id) as User | null;

    return user;
  }

  async createDefaultAdminUser(): Promise<void> {
    const userCount = this.db.query('SELECT COUNT(*) as count FROM users').get() as any;
    if (userCount.count === 0) {
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
      const hashedPassword = await this.hashPassword(defaultPassword);
      
      this.db.run(
        'INSERT INTO users (username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)',
        ['admin', 'admin@localhost', hashedPassword, 'admin', true]
      );
      
      console.log('\n🔐 Default admin user created:');
      console.log('   Username: admin');
      console.log('   Password: [hidden] (see DEFAULT_ADMIN_PASSWORD environment variable or your configuration)');
      console.log('   Please change this password after first login!\n');
    }
  }

  getUserByUsername(username: string): User | null {
    return this.db.query('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username) as User | null;
  }

  updateUserLastLogin(userId: number): void {
    this.db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
  }
}
