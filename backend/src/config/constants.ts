// JWT configuration
export const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // Single long-lived token
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your-super-secret-refresh-key-change-in-production';

// Token renewal configuration
export const TOKEN_RENEWAL_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours - minimum time between renewals

// Database configuration
export const DB_PATH = process.env.DB_PATH || require('path').join(import.meta.dir, '..', '..', 'db.sqlite');

// Certificate configuration
export const DEFAULT_CERT_CHECK_INTERVAL = 6 * 60 * 60; // 6 hours in seconds
