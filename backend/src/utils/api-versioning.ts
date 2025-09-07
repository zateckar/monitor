import { Elysia } from 'elysia';
import { API_VERSIONS } from './auth-constants';

/**
 * API version configuration
 */
export const API_VERSION_CONFIG = {
  CURRENT: API_VERSIONS.CURRENT,
  SUPPORTED: [API_VERSIONS.V1] as const,
  DEFAULT: API_VERSIONS.V1,
  HEADER_NAME: 'X-API-Version',
  QUERY_PARAM: 'api_version'
} as const;

/**
 * Versioned route builder
 */
export class VersionedRouteBuilder {
  private app: Elysia;
  private basePath: string;

  constructor(app: Elysia, basePath: string = '/api') {
    this.app = app;
    this.basePath = basePath;
  }

  /**
   * Create a versioned route group
   */
  version(version: string = API_VERSION_CONFIG.CURRENT) {
    const versionedPath = `${this.basePath}/${version}`;
    return new Elysia({ prefix: versionedPath });
  }

  /**
   * Create routes for all supported versions
   */
  multiVersion(routeDefinitions: Record<string, (version: string) => Elysia>) {
    const versionedApps: Elysia[] = [];

    for (const version of API_VERSION_CONFIG.SUPPORTED) {
      if (routeDefinitions[version]) {
        const versionedApp = routeDefinitions[version](version);
        versionedApps.push(versionedApp);
      }
    }

    return versionedApps;
  }
}

/**
 * API version negotiation middleware
 */
export function apiVersionMiddleware() {
  return (app: Elysia) => app.derive(({ headers, query }: any) => {
    // Check header first, then query parameter, then default
    const versionFromHeader = headers[API_VERSION_CONFIG.HEADER_NAME.toLowerCase()];
    const versionFromQuery = query[API_VERSION_CONFIG.QUERY_PARAM];

    const requestedVersion = versionFromHeader || versionFromQuery || API_VERSION_CONFIG.DEFAULT;

    // Validate version
    const isSupported = API_VERSION_CONFIG.SUPPORTED.includes(requestedVersion as any);

    return {
      apiVersion: isSupported ? requestedVersion : API_VERSION_CONFIG.DEFAULT,
      isVersionSupported: isSupported
    };
  });
}

/**
 * Version compatibility checker
 */
export class VersionCompatibility {
  /**
   * Check if a version is supported
   */
  static isSupported(version: string): boolean {
    return API_VERSION_CONFIG.SUPPORTED.includes(version as any);
  }

  /**
   * Get the latest supported version
   */
  static getLatest(): string {
    const supported = API_VERSION_CONFIG.SUPPORTED;
    return supported[supported.length - 1] || API_VERSION_CONFIG.DEFAULT;
  }

  /**
   * Check if version A is compatible with version B
   */
  static isCompatible(versionA: string, versionB: string): boolean {
    // Simple compatibility check - same major version
    const majorA = versionA.split('.')[0];
    const majorB = versionB.split('.')[0];
    return majorA === majorB;
  }

  /**
   * Get version info for responses
   */
  static getVersionInfo() {
    return {
      current: API_VERSION_CONFIG.CURRENT,
      supported: API_VERSION_CONFIG.SUPPORTED,
      default: API_VERSION_CONFIG.DEFAULT
    };
  }
}

/**
 * Version-aware response wrapper
 */
export function createVersionedResponse<T>(
  data: T,
  version: string = API_VERSION_CONFIG.CURRENT
) {
  return {
    data,
    api_version: version,
    timestamp: new Date().toISOString()
  };
}

/**
 * Deprecation warning for older API versions
 */
export function addDeprecationWarning(version: string) {
  return (app: Elysia) => app.derive(() => {
    const latest = VersionCompatibility.getLatest();
    if (version !== latest) {
      return {
        deprecation_warning: `API version ${version} is deprecated. Please use ${latest}.`
      };
    }
    return {};
  });
}

/**
 * Helper functions for version management
 */
export const VersionUtils = {
  /**
   * Create versioned route prefix
   */
  createVersionedPrefix(version: string = API_VERSION_CONFIG.CURRENT): string {
    return `/api/${version}`;
  },

  /**
   * Extract version from path
   */
  extractVersionFromPath(path: string): string | null {
    const match = path.match(/^\/api\/([^\/]+)/);
    return match ? (match[1] ?? null) : null;
  },

  /**
   * Normalize version string
   */
  normalizeVersion(version: string): string {
    // Remove 'v' prefix if present
    return version.startsWith('v') ? version.substring(1) : version;
  },

  /**
   * Create version-specific route
   */
  createVersionedRoute(
    version: string,
    routeDefinition: (app: Elysia) => Elysia
  ): Elysia {
    const prefix = VersionUtils.createVersionedPrefix(version);
    const app = new Elysia({ prefix });
    return routeDefinition(app as any) as any;
  }
};

/**
 * API version documentation generator
 */
export class ApiVersionDocs {
  private versions: Map<string, any[]> = new Map();

  /**
   * Register routes for a specific version
   */
  registerVersion(version: string, routes: any[]) {
    this.versions.set(version, routes);
  }

  /**
   * Get documentation for all versions
   */
  getDocumentation() {
    const docs: Record<string, any> = {};

    for (const [version, routes] of this.versions) {
      docs[version] = {
        version,
        routes: routes.map(route => ({
          path: route.path,
          method: route.method,
          description: route.description || 'No description'
        })),
        isCurrent: version === API_VERSION_CONFIG.CURRENT,
        isSupported: VersionCompatibility.isSupported(version)
      };
    }

    return docs;
  }

  /**
   * Get migration guide between versions
   */
  getMigrationGuide(fromVersion: string, toVersion: string) {
    // This would contain version-specific migration information
    return {
      from: fromVersion,
      to: toVersion,
      changes: [],
      breaking: false
    };
  }
}