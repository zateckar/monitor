// JWT configuration
export const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'; // Short-lived access tokens
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d'; // Extended refresh tokens
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your-super-secret-refresh-key-change-in-production';

// Activity tracking configuration
export const USER_ACTIVITY_EXTEND_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
export const REFRESH_TOKEN_MAX_LIFETIME = 90 * 24 * 60 * 60 * 1000; // 90 days maximum lifetime

// Database configuration
export const DB_PATH = process.env.DB_PATH || require('path').join(import.meta.dir, '..', '..', 'db.sqlite');

// Certificate configuration
export const DEFAULT_CERT_CHECK_INTERVAL = 6 * 60 * 60; // 6 hours in seconds
