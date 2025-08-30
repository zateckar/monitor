export interface ApiOptions extends RequestInit {
  skipAuth?: boolean;
}

export const apiClient = async (url: string, options: ApiOptions = {}): Promise<Response> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { skipAuth: _skipAuth = false, ...fetchOptions } = options;

  // Always include credentials for cookie-based auth
  const requestOptions: RequestInit = {
    credentials: 'include',
    ...fetchOptions,
  };

  try {
    const response = await fetch(url, requestOptions);
    return response;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
};

// Helper functions for common HTTP methods
export const api = {
  get: (url: string, options?: ApiOptions) => 
    apiClient(url, { ...options, method: 'GET' }),
  
  post: (url: string, data?: unknown, options?: ApiOptions) => 
    apiClient(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    }),
  
  put: (url: string, data?: unknown, options?: ApiOptions) => 
    apiClient(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    }),
  
  patch: (url: string, data?: unknown, options?: ApiOptions) => 
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
};

// For backwards compatibility
export const useApi = () => api;
export const useApiClient = () => apiClient;
export const createApiClient = () => apiClient;
export const createApiHelpers = () => api;
