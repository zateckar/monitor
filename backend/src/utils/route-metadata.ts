import { Elysia } from 'elysia';
import type { RouteMetadata } from './auth-constants';
import { AUTH_LEVELS, API_VERSIONS } from './auth-constants';

/**
 * Route metadata registry for storing and retrieving route information
 */
export class RouteMetadataRegistry {
  private static instance: RouteMetadataRegistry;
  private metadata: Map<string, RouteMetadata> = new Map();

  static getInstance(): RouteMetadataRegistry {
    if (!RouteMetadataRegistry.instance) {
      RouteMetadataRegistry.instance = new RouteMetadataRegistry();
    }
    return RouteMetadataRegistry.instance;
  }

  /**
   * Register metadata for a route
   */
  register(path: string, metadata: RouteMetadata) {
    this.metadata.set(path, metadata);
  }

  /**
   * Get metadata for a specific route
   */
  get(path: string): RouteMetadata | undefined {
    return this.metadata.get(path);
  }

  /**
   * Get all route metadata
   */
  getAll(): Map<string, RouteMetadata> {
    return new Map(this.metadata);
  }

  /**
   * Get routes by tag
   */
  getRoutesByTag(tag: string): string[] {
    const routes: string[] = [];
    for (const [path, metadata] of this.metadata) {
      if (metadata.tags.includes(tag)) {
        routes.push(path);
      }
    }
    return routes;
  }

  /**
   * Get deprecated routes
   */
  getDeprecatedRoutes(): string[] {
    const routes: string[] = [];
    for (const [path, metadata] of this.metadata) {
      if (metadata.deprecated) {
        routes.push(path);
      }
    }
    return routes;
  }

  /**
   * Get routes by auth level
   */
  getRoutesByAuthLevel(authLevel: typeof AUTH_LEVELS[keyof typeof AUTH_LEVELS]): string[] {
    const routes: string[] = [];
    for (const [path, metadata] of this.metadata) {
      if (metadata.auth === authLevel) {
        routes.push(path);
      }
    }
    return routes;
  }
}

/**
 * Helper functions for creating route metadata
 */
export const RouteMeta = {
  /**
   * Create public route metadata
   */
  public: (description: string, tags: string[] = [], version = API_VERSIONS.CURRENT): RouteMetadata => ({
    description,
    auth: AUTH_LEVELS.PUBLIC,
    tags,
    version
  }),

  /**
   * Create user route metadata
   */
  user: (description: string, tags: string[] = [], version = API_VERSIONS.CURRENT): RouteMetadata => ({
    description,
    auth: AUTH_LEVELS.USER,
    tags,
    version
  }),

  /**
   * Create admin route metadata
   */
  admin: (description: string, tags: string[] = [], version = API_VERSIONS.CURRENT): RouteMetadata => ({
    description,
    auth: AUTH_LEVELS.ADMIN,
    tags,
    version
  }),

  /**
   * Mark a route as deprecated
   */
  deprecated: (metadata: RouteMetadata, deprecationNote?: string): RouteMetadata => ({
    ...metadata,
    deprecated: true,
    description: `${metadata.description} [DEPRECATED${deprecationNote ? `: ${deprecationNote}` : ''}]`
  })
};

/**
 * Route registry for auto-discovery
 */
export class RouteRegistry {
  private static instance: RouteRegistry;
  private routes: Map<string, { factory: Function; metadata?: RouteMetadata }> = new Map();

  static getInstance(): RouteRegistry {
    if (!RouteRegistry.instance) {
      RouteRegistry.instance = new RouteRegistry();
    }
    return RouteRegistry.instance;
  }

  /**
   * Register a route factory
   */
  register(name: string, factory: Function, metadata?: RouteMetadata) {
    this.routes.set(name, { factory, metadata });
  }

  /**
   * Get all registered routes
   */
  getAll(): Map<string, { factory: Function; metadata?: RouteMetadata }> {
    return new Map(this.routes);
  }

  /**
   * Get a specific route
   */
  get(name: string): { factory: Function; metadata?: RouteMetadata } | undefined {
    return this.routes.get(name);
  }

  /**
   * Create all registered routes with services
   */
  createAll(services: any): Elysia[] {
    const routeInstances: Elysia[] = [];
    for (const [name, { factory }] of this.routes) {
      try {
        const route = factory(services);
        routeInstances.push(route);
      } catch (error) {
        console.error(`Failed to create route ${name}:`, error);
      }
    }
    return routeInstances;
  }
}