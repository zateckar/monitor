// JWT configuration
export const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Database configuration
export const DB_PATH = process.env.DB_PATH || require('path').join(import.meta.dir, '..', '..', 'db.sqlite');
