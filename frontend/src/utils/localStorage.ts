/**
 * Utility functions for local storage operations
 */

const CHART_TIME_PERIOD_KEY = 'chart_time_period';

/**
 * Get the stored chart time period from local storage
 * @returns The stored time period or default value if not found
 */
export const getStoredTimePeriod = (): string => {
  try {
    const stored = localStorage.getItem(CHART_TIME_PERIOD_KEY);
    if (stored && ['3h', '6h', '24h', '1w'].includes(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn('Failed to read time period from localStorage:', error);
  }
  return '24h'; // Default fallback
};

/**
 * Store the chart time period to local storage
 * @param timePeriod The time period to store
 */
export const storeTimePeriod = (timePeriod: string): void => {
  try {
    localStorage.setItem(CHART_TIME_PERIOD_KEY, timePeriod);
  } catch (error) {
    console.warn('Failed to store time period to localStorage:', error);
  }
};

/**
 * Clear the stored chart time period
 */
export const clearStoredTimePeriod = (): void => {
  try {
    localStorage.removeItem(CHART_TIME_PERIOD_KEY);
  } catch (error) {
    console.warn('Failed to clear time period from localStorage:', error);
  }
};
