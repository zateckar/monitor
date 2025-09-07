/**
 * Standardized authentication levels for consistent route protection
 */
export const AUTH_LEVELS = {
  PUBLIC: null,                    // No authentication required
  USER: 'user',                    // Any authenticated user
  ADMIN: 'admin'                   // Admin privileges required
} as const;

export type AuthLevel = typeof AUTH_LEVELS[keyof typeof AUTH_LEVELS];

/**
 * Standard response formats for consistent API responses
 */
export const RESPONSE_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error'
} as const;

/**
 * API versioning constants
 */
export const API_VERSIONS = {
  V1: 'v1',
  CURRENT: 'v1'
} as const;

/**
 * Route metadata interface for better documentation and maintenance
 */
export interface RouteMetadata {
  description: string;
  auth: AuthLevel;
  tags: string[];
  deprecated?: boolean;
  version?: string;
}

/**
 * Standard success response format
 */
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  message?: string;
  timestamp?: string;
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
  timestamp?: string;
}

/**
 * Union type for all API responses
 */
export type ApiResponse<T = any> = SuccessResponse<T> | ErrorResponse;

/**
 * Helper function to create standardized success responses
 */
export function createSuccessResponse<T>(
  data: T,
  message?: string
): SuccessResponse<T> {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString()
  };
}

/**
 * Helper function to create standardized error responses
 */
export function createErrorResponse(
  error: string,
  details?: any
): ErrorResponse {
  return {
    success: false,
    error,
    details,
    timestamp: new Date().toISOString()
  };
}