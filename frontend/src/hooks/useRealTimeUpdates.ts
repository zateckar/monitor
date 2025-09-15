import { useState, useEffect, useCallback, useRef } from 'react';

export interface RealTimeConfig {
  interval?: number;
  enabled?: boolean;
  onError?: (error: Error) => void;
  retryCount?: number;
  retryDelay?: number;
}

export interface RealTimeStatus {
  isConnected: boolean;
  lastUpdate: Date | null;
  errorCount: number;
  retryAttempt: number;
}

export function useRealTimeUpdates<T>(
  fetchFunction: () => Promise<T>,
  config: RealTimeConfig = {}
) {
  const {
    interval = 30000,
    enabled = false,
    onError,
    retryCount = 3,
    retryDelay = 5000
  } = config;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<RealTimeStatus>({
    isConnected: false,
    lastUpdate: null,
    errorCount: 0,
    retryAttempt: 0
  });
  const [dynamicEnabled, setDynamicEnabled] = useState(enabled);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async (isRetry = false, isBackground = false) => {
    if (!mountedRef.current) return;

    // Only set loading for non-background fetches
    if (!isBackground) {
      setLoading(true);
    }

    try {

      const result = await fetchFunction();

      if (!mountedRef.current) return;

      setData(result);
      setStatus(prev => ({
        isConnected: true,
        lastUpdate: new Date(),
        errorCount: 0,
        retryAttempt: 0
      }));
    } catch (error) {
      if (!mountedRef.current) return;

      const errorObj = error instanceof Error ? error : new Error('Unknown error');
      console.log(`[DEBUG] useRealTimeUpdates: fetchData failed: ${errorObj.message}`);

      setStatus(prev => {
        const newErrorCount = prev.errorCount + 1;
        const newRetryAttempt = isRetry ? prev.retryAttempt + 1 : 0;


        return {
          isConnected: false,
          lastUpdate: prev.lastUpdate,
          errorCount: newErrorCount,
          retryAttempt: newRetryAttempt
        };
      });

      if (onError) {
        onError(errorObj);
      }

      // Implement retry logic
      if (status.retryAttempt < retryCount) {
        retryTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            fetchData(true);
          }
        }, retryDelay);
      } else {
      }
    } finally {
      if (mountedRef.current && !isRetry) {
        setLoading(false);
      }
    }
  }, [fetchFunction, onError, retryCount, retryDelay]);

  const startPolling = useCallback(() => {
    if (!dynamicEnabled || intervalRef.current) return;

    // Initial fetch
    fetchData(false, false);

    // Set up interval
    intervalRef.current = setInterval(() => {
      if (dynamicEnabled) {
        fetchData(false, true);
      }
    }, interval);
  }, [dynamicEnabled, interval, fetchData]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const forceRefresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Start/stop polling based on enabled state
  useEffect(() => {
    if (dynamicEnabled) {
      startPolling();
    } else {
      stopPolling();
    }

    return stopPolling;
  }, [dynamicEnabled, startPolling, stopPolling]);

  // Update dynamic enabled when config enabled changes
  useEffect(() => {
    setDynamicEnabled(enabled);
  }, [enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  return {
    data,
    loading,
    status,
    forceRefresh,
    startPolling,
    stopPolling,
    setDynamicEnabled
  };
}

// Specialized hook for distributed monitoring data - simplified, no realtime updates
export function useDistributedMonitoringUpdates(enabled = true) {
  // For simplicity, always return standalone mode data - no API calls, no realtime updates
  const hook = useRealTimeUpdates(
    async () => {
      // Always return standalone mode data - no instance data, no realtime updates
      return {
        instances: [],
        health: null,
        hasDistributedData: false
      };
    },
    {
      interval: 150000, // Keep interval but disable polling
      enabled: false, // Completely disable realtime updates
      retryCount: 0, // No retries
      onError: (error) => {
        // Silent error handling
      }
    }
  );

  return hook;
}

// Hook for endpoint monitoring updates
export function useEndpointUpdates(endpointId?: number, enabled = true) {
  return useRealTimeUpdates(
    async () => {
      if (!endpointId) return null;

      const [endpointResponse, responsesResponse] = await Promise.all([
        fetch(`/api/endpoints/${endpointId}`),
        fetch(`/api/endpoints/${endpointId}/response-times?limit=100`)
      ]);

      if (!endpointResponse.ok || !responsesResponse.ok) {
        throw new Error('Failed to fetch endpoint data');
      }

      const [endpoint, responses] = await Promise.all([
        endpointResponse.json(),
        responsesResponse.json()
      ]);

      return { endpoint, responses };
    },
    {
      interval: 10000, // Frequent updates for individual endpoint monitoring
      enabled: enabled && !!endpointId,
      retryCount: 3
    }
  );
}

// Hook for multi-location status updates - simplified, no realtime updates
export function useMultiLocationUpdates(endpointId?: number, enabled = true) {
  // For simplicity, always return standalone mode data - no API calls, no realtime updates
  const hook = useRealTimeUpdates(
    async () => {
      if (!endpointId) return null;

      // Always return standalone mode data - no location data, no realtime updates
      return {
        aggregated: null,
        locations: [],
        hasDistributedData: false
      };
    },
    {
      interval: 15000, // Keep interval but disable polling
      enabled: false, // Completely disable realtime updates
      retryCount: 0, // No retries
      onError: (error) => {
        // Silent error handling
      }
    }
  );

  return hook;
}