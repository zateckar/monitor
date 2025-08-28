import { useAuth } from '../contexts/AuthContext';

// Create a singleton to track refresh attempts and avoid infinite loops
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

export interface ApiOptions extends RequestInit {
  skipRefresh?: boolean;
}

export const createApiClient = (refreshTokenFn: () => Promise<boolean>) => {
  const apiClient = async (url: string, options: ApiOptions = {}): Promise<Response> => {
    const { skipRefresh = false, ...fetchOptions } = options;

    // Always include credentials for cookie-based auth
    const requestOptions: RequestInit = {
      credentials: 'include',
      ...fetchOptions,
    };

    try {
      const response = await fetch(url, requestOptions);

      // If request is successful or we should skip refresh, return response
      if (response.ok || skipRefresh || response.status !== 401) {
        return response;
      }

      // Handle 401 Unauthorized - attempt token refresh
      console.log('Received 401, attempting token refresh...');

      // If we're already refreshing, wait for that refresh to complete
      if (isRefreshing && refreshPromise) {
        const refreshSuccess = await refreshPromise;
        if (refreshSuccess) {
          // Retry the original request
          return fetch(url, requestOptions);
        } else {
          // Refresh failed, return the original 401 response
          return response;
        }
      }

      // Start refresh process
      isRefreshing = true;
      refreshPromise = refreshTokenFn();

      try {
        const refreshSuccess = await refreshPromise;
        
        if (refreshSuccess) {
          console.log('Token refresh successful, retrying request...');
          // Retry the original request with new token
          return fetch(url, requestOptions);
        } else {
          console.log('Token refresh failed');
          // Refresh failed, return the original 401 response
          return response;
        }
      } finally {
        isRefreshing = false;
        refreshPromise = null;
      }

    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  };

  return apiClient;
};

// Hook to get API client with auth context
export const useApiClient = () => {
  const { refreshToken } = useAuth();
  return createApiClient(refreshToken);
};

// Helper functions for common HTTP methods
export const createApiHelpers = (apiClient: ReturnType<typeof createApiClient>) => ({
  get: (url: string, options?: ApiOptions) => 
    apiClient(url, { ...options, method: 'GET' }),
  
  post: (url: string, data?: any, options?: ApiOptions) => 
    apiClient(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    }),
  
  put: (url: string, data?: any, options?: ApiOptions) => 
    apiClient(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    }),
  
  patch: (url: string, data?: any, options?: ApiOptions) => 
    apiClient(url, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    }),
  
  delete: (url: string, options?: ApiOptions) => 
    apiClient(url, { ...options, method: 'DELETE' }),
});

// Hook to get API helpers
export const useApi = () => {
  const apiClient = useApiClient();
  return createApiHelpers(apiClient);
};
