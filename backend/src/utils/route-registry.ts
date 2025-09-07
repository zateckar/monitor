import { Elysia } from 'elysia';

/**
 * Enhanced route registry with auto-discovery capabilities
 */
export class RouteAutoRegistry {
  private static instance: RouteAutoRegistry;
  private registeredRoutes: Map<string, { factory: Function; metadata?: any; module: string }> = new Map();

  static getInstance(): RouteAutoRegistry {
    if (!RouteAutoRegistry.instance) {
      RouteAutoRegistry.instance = new RouteAutoRegistry();
    }
    return RouteAutoRegistry.instance;
  }

  /**
   * Auto-discover and register routes from route modules
   */
  async autoDiscoverRoutes(): Promise<void> {
    // Import all route modules dynamically
    const routeModules = [
      'auth',
      'endpoints',
      'users',
      'oidc',
      'preferences',
      'status-pages',
      'sync',
      'system',
      'notifications'
    ];

    for (const moduleName of routeModules) {
      try {
        const module = await import(`../routes/${moduleName}`);
        const factoryFunction = module[`create${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Routes`];

        if (factoryFunction) {
          this.register(moduleName, factoryFunction, { module: moduleName });
        } else {
          console.warn(`No factory function found for route module: ${moduleName}`);
        }
      } catch (error) {
        console.error(`Failed to load route module: ${moduleName}`, error);
      }
    }
  }

  /**
   * Register a route factory with metadata
   */
  register(name: string, factory: Function, metadata?: any) {
    this.registeredRoutes.set(name, {
      factory,
      metadata: metadata || {},
      module: metadata?.module || name
    });
  }

  /**
   * Get all registered routes
   */
  getAll(): Map<string, { factory: Function; metadata?: any; module: string }> {
    return new Map(this.registeredRoutes);
  }

  /**
   * Create all registered routes with services
   */
  createAll(services: any): Elysia[] {
    const routeInstances: Elysia[] = [];

    for (const [name, { factory }] of this.registeredRoutes) {
      try {
        const route = factory(services);
        routeInstances.push(route);
      } catch (error) {
        console.error(`Failed to create route ${name}:`, error);
      }
    }

    return routeInstances;
  }

  /**
   * Create main application with all routes
   */
  async createApp(services: any): Promise<Elysia> {
    // Auto-discover routes if not already done
    if (this.registeredRoutes.size === 0) {
      await this.autoDiscoverRoutes();
    }

    const app = new Elysia();

    // Create and mount all routes
    const routes = this.createAll(services);
    for (const route of routes) {
      app.use(route);
    }

    return app;
  }

  /**
   * Get route statistics
   */
  getStats() {
    const stats = {
      totalRoutes: this.registeredRoutes.size,
      modules: [] as string[],
      routesByModule: {} as Record<string, number>
    };

    for (const [name, { module }] of this.registeredRoutes) {
      if (!stats.modules.includes(module)) {
        stats.modules.push(module);
      }
      stats.routesByModule[module] = (stats.routesByModule[module] || 0) + 1;
    }

    return stats;
  }
}

/**
 * Route factory interface for type safety
 */
export interface RouteFactory {
  (services: any): Elysia;
}

/**
 * Route module definition
 */
export interface RouteModule {
  name: string;
  factory: RouteFactory;
  metadata?: any;
}

/**
 * Helper function to create route modules
 */
export function createRouteModule(
  name: string,
  factory: RouteFactory,
  metadata?: any
): RouteModule {
  return {
    name,
    factory,
    metadata: metadata || {}
  };
}

/**
 * Batch route registration utility
 */
export class RouteBatchRegistrar {
  private registry: RouteAutoRegistry;

  constructor() {
    this.registry = RouteAutoRegistry.getInstance();
  }

  /**
   * Register multiple routes at once
   */
  registerBatch(modules: RouteModule[]): void {
    for (const module of modules) {
      this.registry.register(module.name, module.factory, module.metadata);
    }
  }

  /**
   * Register routes from a directory pattern
   */
  async registerFromDirectory(pattern: string): Promise<void> {
    // This would use Bun's file system APIs to discover routes
    // For now, we'll use the auto-discovery method
    await this.registry.autoDiscoverRoutes();
  }

  /**
   * Get registration summary
   */
  getSummary() {
    return this.registry.getStats();
  }
}