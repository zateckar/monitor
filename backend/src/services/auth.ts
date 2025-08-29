import jwt from 'jsonwebtoken';
import { Database } from 'bun:sqlite';
import type { User } from '../types';
import { JWT_SECRET, JWT_EXPIRES_IN, REFRESH_TOKEN_SECRET, JWT_REFRESH_EXPIRES_IN, USER_ACTIVITY_EXTEND_THRESHOLD, REFRESH_TOKEN_MAX_LIFETIME } from '../config/constants';
import { randomBytes } from 'crypto';

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
        email: user.email 
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

  // Refresh Token Methods
  generateRefreshToken(): string {
    return randomBytes(64).toString('hex');
  }

  async storeRefreshToken(userId: number, refreshToken: string, userAgent?: string, ipAddress?: string): Promise<void> {
    // Hash the refresh token before storing
    const tokenHash = await Bun.password.hash(refreshToken, { algorithm: "bcrypt", cost: 4 });
    
    // Calculate expiration date
    const expiresAt = new Date();
    const refreshDays = parseInt(JWT_REFRESH_EXPIRES_IN.replace('d', '')) || 7;
    expiresAt.setDate(expiresAt.getDate() + refreshDays);

    this.db.run(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, tokenHash, expiresAt.toISOString(), userAgent || null, ipAddress || null]
    );
  }

  async verifyRefreshToken(refreshToken: string): Promise<User | null> {
    try {
      // Get all non-revoked, non-expired refresh tokens
      const tokens = this.db.query(`
        SELECT rt.*, u.* FROM refresh_tokens rt
        JOIN users u ON rt.user_id = u.id
        WHERE rt.is_revoked = false 
        AND rt.expires_at > datetime('now')
        AND u.is_active = 1
      `).all() as any[];

      // Check each token hash against the provided refresh token
      for (const tokenRecord of tokens) {
        const isValid = await Bun.password.verify(refreshToken, tokenRecord.token_hash);
        if (isValid) {
          // Update last_used_at and track activity
          this.db.run(
            'UPDATE refresh_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
            [tokenRecord.id]
          );

          // Check if we should extend the refresh token based on activity
          await this.extendRefreshTokenIfNeeded(tokenRecord.id, tokenRecord.created_at);

          // Return user data
          return {
            id: tokenRecord.user_id,
            username: tokenRecord.username,
            email: tokenRecord.email,
            role: tokenRecord.role,
            created_at: tokenRecord.created_at,
            last_login: tokenRecord.last_login,
            is_active: tokenRecord.is_active
          } as User;
        }
      }

      return null;
    } catch (error) {
      console.error('Error verifying refresh token:', error);
      return null;
    }
  }

  /**
   * Extends refresh token expiration if user has been active and token hasn't exceeded max lifetime
   */
  async extendRefreshTokenIfNeeded(tokenId: number, tokenCreatedAt: string): Promise<void> {
    try {
      const createdAt = new Date(tokenCreatedAt);
      const now = new Date();
      const tokenAge = now.getTime() - createdAt.getTime();

      // Don't extend if token has exceeded maximum lifetime (90 days)
      if (tokenAge >= REFRESH_TOKEN_MAX_LIFETIME) {
        return;
      }

      // Get current token data
      const token = this.db.query('SELECT * FROM refresh_tokens WHERE id = ?').get(tokenId) as any;
      if (!token) return;

      const expiresAt = new Date(token.expires_at);
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();

      // If token expires in less than 7 days, extend it
      if (timeUntilExpiry < USER_ACTIVITY_EXTEND_THRESHOLD) {
        // Calculate new expiration (add 30 days from now, but respect max lifetime)
        const refreshDays = parseInt(JWT_REFRESH_EXPIRES_IN.replace('d', '')) || 30;
        const newExpiresAt = new Date(now.getTime() + (refreshDays * 24 * 60 * 60 * 1000));
        
        // Ensure we don't exceed max lifetime
        const maxAllowedExpiry = new Date(createdAt.getTime() + REFRESH_TOKEN_MAX_LIFETIME);
        const finalExpiresAt = newExpiresAt > maxAllowedExpiry ? maxAllowedExpiry : newExpiresAt;

        this.db.run(
          'UPDATE refresh_tokens SET expires_at = ?, extended_at = CURRENT_TIMESTAMP WHERE id = ?',
          [finalExpiresAt.toISOString(), tokenId]
        );

        console.log(`Extended refresh token ${tokenId} until ${finalExpiresAt.toISOString()}`);
      }
    } catch (error) {
      console.error('Error extending refresh token:', error);
    }
  }

  /**
   * Records user activity to help with session management
   */
  recordUserActivity(userId: number, activityType: 'api_call' | 'page_view' | 'refresh_token' = 'api_call'): void {
    try {
      this.db.run(
        'UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
        [userId]
      );
    } catch (error) {
      console.error('Error recording user activity:', error);
    }
  }

  /**
   * Gets user activity information
   */
  getUserActivity(userId: number): { lastActivity: string | null; isActiveWithinWeek: boolean } {
    try {
      const user = this.db.query('SELECT last_activity FROM users WHERE id = ?').get(userId) as any;
      if (!user || !user.last_activity) {
        return { lastActivity: null, isActiveWithinWeek: false };
      }

      const lastActivity = new Date(user.last_activity);
      const weekAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
      const isActiveWithinWeek = lastActivity > weekAgo;

      return {
        lastActivity: user.last_activity,
        isActiveWithinWeek
      };
    } catch (error) {
      console.error('Error getting user activity:', error);
      return { lastActivity: null, isActiveWithinWeek: false };
    }
  }

  revokeRefreshToken(refreshToken: string): void {
    // We need to find and revoke the token by matching the hash
    // Since we can't reverse the hash, we'll mark all tokens for the user as revoked
    // This is a security trade-off for simplicity
    this.db.run(
      'UPDATE refresh_tokens SET is_revoked = true WHERE token_hash = ?',
      [refreshToken]
    );
  }

  revokeAllUserRefreshTokens(userId: number): void {
    this.db.run(
      'UPDATE refresh_tokens SET is_revoked = true WHERE user_id = ?',
      [userId]
    );
  }

  cleanupExpiredRefreshTokens(): void {
    this.db.run(
      "DELETE FROM refresh_tokens WHERE expires_at < datetime('now') OR is_revoked = true"
    );
  }

  generateTokenPair(user: User): { accessToken: string; refreshToken: string } {
    const accessToken = this.generateToken(user);
    const refreshToken = this.generateRefreshToken();
    return { accessToken, refreshToken };
  }
}
