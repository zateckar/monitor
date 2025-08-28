// JWT configuration
export const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'; // Short-lived access tokens
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d'; // Long-lived refresh tokens
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your-super-secret-refresh-key-change-in-production';

// Database configuration
export const DB_PATH = process.env.DB_PATH || require('path').join(import.meta.dir, '..', '..', 'db.sqlite');

// Certificate configuration
export const DEFAULT_CERT_CHECK_INTERVAL = 6 * 60 * 60; // 6 hours in seconds
