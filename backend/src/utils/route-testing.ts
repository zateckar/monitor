import { AUTH_LEVELS, createSuccessResponse, createErrorResponse } from './auth-constants';

/**
 * Route testing utilities for consistent testing patterns
 */
export class RouteTester {
  /**
   * Test route response format
   */
  validateResponseFormat(response: any, expectedSuccess: boolean = true) {
    const result = {
      isValid: false,
      errors: [] as string[]
    };

    if (expectedSuccess) {
      if (!response.success) {
        result.errors.push('Response should have success: true');
      }
      if (!response.data && response.data !== null) {
        result.errors.push('Response should have data property');
      }
    } else {
      if (response.success !== false) {
        result.errors.push('Error response should have success: false');
      }
      if (!response.error) {
        result.errors.push('Error response should have error property');
      }
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Test route with different authentication levels
   */
  async testAuthLevels(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: {
      body?: any;
      headers?: Record<string, string>;
      query?: Record<string, string>;
    } = {}
  ) {
    const results = {
      public: null as any,
      user: null as any,
      admin: null as any
    };

    // Test public access
    try {
      results.public = await this.testAuthenticatedRoute(method, path, {
        ...options,
        auth: AUTH_LEVELS.PUBLIC
      });
    } catch (error: any) {
      results.public = { error: error.message };
    }

    // Test user access
    try {
      results.user = await this.testAuthenticatedRoute(method, path, {
        ...options,
        auth: AUTH_LEVELS.USER
      });
    } catch (error: any) {
      results.user = { error: error.message };
    }

    // Test admin access
    try {
      results.admin = await this.testAuthenticatedRoute(method, path, {
        ...options,
        auth: AUTH_LEVELS.ADMIN
      });
    } catch (error: any) {
      results.admin = { error: error.message };
    }

    return results;
  }

  /**
   * Test a route with authentication
   */
  async testAuthenticatedRoute(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: {
      auth?: typeof AUTH_LEVELS[keyof typeof AUTH_LEVELS];
      body?: any;
      headers?: Record<string, string>;
      query?: Record<string, string>;
      user?: any;
    } = {}
  ) {
    const { auth = AUTH_LEVELS.USER, body, headers = {}, query, user } = options;

    // Create mock request context
    const mockContext = {
      request: {
        method,
        url: `http://localhost:3001${path}`,
        headers: new Headers({
          'Content-Type': 'application/json',
          ...headers
        })
      },
      body,
      query,
      user,
      set: { status: 200 }
    };

    // Add authentication headers based on auth level
    if (auth !== AUTH_LEVELS.PUBLIC) {
      // Mock JWT token for authenticated routes
      mockContext.request.headers.set('Authorization', 'Bearer mock-jwt-token');
    }

    return mockContext;
  }
}

/**
 * Mock services for testing
 */
export class MockServices {
  static create() {
    return {
      db: {
        query: () => [],
        run: () => ({ lastInsertRowid: 1 }),
        prepare: () => ({
          all: () => [],
          get: () => null,
          run: () => ({})
        })
      },
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
        getLogLevel: () => 'info',
        setLogLevel: () => {}
      },
      authService: {
        authenticateUser: () => null,
        generateToken: () => 'mock-token',
        verifyToken: () => null,
        hashPassword: () => 'hashed-password',
        verifyPassword: () => true,
        getUserByUsername: () => null,
        updateUserLastLogin: () => {},
        createDefaultAdminUser: () => {}
      },
      requireAuth: () => {},
      requireRole: (role: string) => (handler: Function) => handler
    };
  }
}

/**
 * Route testing helpers
 */
export const RouteTestHelpers = {
  /**
   * Create mock request context
   */
  createMockContext(overrides: any = {}) {
    return {
      request: {
        method: 'GET',
        url: 'http://localhost:3001/test',
        headers: new Headers()
      },
      body: null,
      query: {},
      params: {},
      set: { status: 200 },
      user: null,
      ...overrides
    };
  },

  /**
   * Validate successful response format
   */
  validateSuccessResponse(response: any, expectedData?: any): boolean {
    if (!response.success) return false;
    if (!response.data && response.data !== null) return false;

    if (expectedData !== undefined) {
      if (JSON.stringify(response.data) !== JSON.stringify(expectedData)) return false;
    }

    // Check for consistent timestamp format
    if (response.timestamp) {
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(response.timestamp);
    }

    return true;
  },

  /**
   * Validate error response format
   */
  validateErrorResponse(response: any, expectedError?: string): boolean {
    if (response.success !== false) return false;
    if (!response.error) return false;
    if (typeof response.error !== 'string') return false;

    if (expectedError && !response.error.includes(expectedError)) return false;

    // Check for consistent timestamp format
    if (response.timestamp) {
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(response.timestamp);
    }

    return true;
  },

  /**
   * Test route with multiple scenarios
   */
  async testRouteScenarios(
    routeHandler: Function,
    scenarios: Array<{
      name: string;
      context: any;
      expected: {
        success: boolean;
        status?: number;
        data?: any;
        error?: string;
      };
    }>
  ) {
    const results = [];

    for (const scenario of scenarios) {
      try {
        const result = await routeHandler(scenario.context);
        results.push({
          scenario: scenario.name,
          success: true,
          result,
          matches: RouteTestHelpers.validateScenario(result, scenario.expected)
        });
      } catch (error: any) {
        results.push({
          scenario: scenario.name,
          success: false,
          error: error.message,
          matches: false
        });
      }
    }

    return results;
  },

  /**
   * Validate test scenario results
   */
  validateScenario(result: any, expected: any): boolean {
    if (expected.success !== undefined && result.success !== expected.success) {
      return false;
    }

    if (expected.status && result.status !== expected.status) {
      return false;
    }

    if (expected.data && JSON.stringify(result.data) !== JSON.stringify(expected.data)) {
      return false;
    }

    if (expected.error && !result.error?.includes(expected.error)) {
      return false;
    }

    return true;
  }
};

/**
 * Integration testing utilities
 */
export class IntegrationTester {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  /**
   * Test full API endpoint
   */
  async testEndpoint(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: {
      body?: any;
      headers?: Record<string, string>;
      auth?: string;
    } = {}
  ) {
    const { body, headers = {}, auth } = options;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers
    };

    if (auth) {
      requestHeaders['Authorization'] = `Bearer ${auth}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined
    });

    const responseBody = await response.json().catch(() => null);

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody
    };
  }

  /**
   * Test authentication flow
   */
  async testAuthFlow(username: string, password: string) {
    // Test login
    const loginResponse = await this.testEndpoint('POST', '/api/auth/login', {
      body: { username, password }
    });

    if (loginResponse.status !== 200) {
      return { success: false, error: 'Login failed', loginResponse };
    }

    const token = (loginResponse.body as any)?.data?.token;
    if (!token) {
      return { success: false, error: 'No token received', loginResponse };
    }

    // Test authenticated endpoint
    const meResponse = await this.testEndpoint('GET', '/api/auth/me', {
      auth: token
    });

    return {
      success: meResponse.status === 200,
      loginResponse,
      meResponse
    };
  }
}