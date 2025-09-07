import { createErrorResponse } from './auth-constants';

/**
 * Standard HTTP status codes for consistent error handling
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503
} as const;

/**
 * Common error types for consistent error classification
 */
export const ERROR_TYPES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',
  CONFLICT_ERROR: 'CONFLICT_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR'
} as const;

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errorType: string;
  public readonly details?: any;

  constructor(
    message: string,
    statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    errorType: string = ERROR_TYPES.INTERNAL_ERROR,
    details?: any
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.details = details;
  }
}

/**
 * Create common error types
 */
export const Errors = {
  /**
   * Validation error (400)
   */
  validation: (message: string, details?: any) =>
    new ApiError(message, HTTP_STATUS.BAD_REQUEST, ERROR_TYPES.VALIDATION_ERROR, details),

  /**
   * Authentication error (401)
   */
  authentication: (message: string = 'Authentication required') =>
    new ApiError(message, HTTP_STATUS.UNAUTHORIZED, ERROR_TYPES.AUTHENTICATION_ERROR),

  /**
   * Authorization error (403)
   */
  authorization: (message: string = 'Insufficient permissions') =>
    new ApiError(message, HTTP_STATUS.FORBIDDEN, ERROR_TYPES.AUTHORIZATION_ERROR),

  /**
   * Not found error (404)
   */
  notFound: (resource: string = 'Resource') =>
    new ApiError(`${resource} not found`, HTTP_STATUS.NOT_FOUND, ERROR_TYPES.NOT_FOUND_ERROR),

  /**
   * Conflict error (409)
   */
  conflict: (message: string) =>
    new ApiError(message, HTTP_STATUS.CONFLICT, ERROR_TYPES.CONFLICT_ERROR),

  /**
   * Internal server error (500)
   */
  internal: (message: string = 'Internal server error', details?: any) =>
    new ApiError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_TYPES.INTERNAL_ERROR, details),

  /**
   * External service error (502)
   */
  externalService: (service: string, details?: any) =>
    new ApiError(
      `External service error: ${service}`,
      HTTP_STATUS.BAD_GATEWAY,
      ERROR_TYPES.EXTERNAL_SERVICE_ERROR,
      details
    )
};

/**
 * Global error handler for Elysia applications
 */
export function createGlobalErrorHandler(logger?: any) {
  return (error: any, context: any) => {
    // Log the error
    if (logger) {
      logger.error(`Request error: ${error.message}`, 'ERROR_HANDLER', {
        url: context.request.url,
        method: context.request.method,
        error: error.message,
        stack: error.stack
      });
    } else {
      console.error('Request error:', error);
    }

    // Handle ApiError instances
    if (error instanceof ApiError) {
      return context.set.status(error.statusCode).json(
        createErrorResponse(error.message, error.details)
      );
    }

    // Handle validation errors from Elysia
    if (error.name === 'ValidationError') {
      return context.set.status(HTTP_STATUS.BAD_REQUEST).json(
        createErrorResponse('Validation failed', error.message)
      );
    }

    // Handle other errors
    const statusCode = error.status || HTTP_STATUS.INTERNAL_SERVER_ERROR;
    const message = error.message || 'An unexpected error occurred';

    return context.set.status(statusCode).json(
      createErrorResponse(message)
    );
  };
}

/**
 * Helper function to get HTTP status from error
 */
export function getStatusFromError(error: any): number {
  if (error instanceof ApiError) {
    return error.statusCode;
  }

  if (error.name === 'ValidationError') {
    return HTTP_STATUS.BAD_REQUEST;
  }

  if (error.status && typeof error.status === 'number') {
    return error.status;
  }

  return HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler(handler: Function) {
  return async (context: any) => {
    try {
      return await handler(context);
    } catch (error) {
      throw error; // Let the global error handler deal with it
    }
  };
}

/**
 * Safe execution wrapper that catches errors and returns consistent responses
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  errorMessage: string = 'Operation failed'
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const data = await operation();
    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : errorMessage;
    return { success: false, error: message };
  }
}