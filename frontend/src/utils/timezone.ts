/**
 * Utility functions for timezone-aware date formatting
 */

/**
 * Get the user's selected timezone from localStorage, fallback to system timezone
 */
export const getUserTimezone = (): string => {
  return localStorage.getItem('app_timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Format a date string using the user's selected timezone
 */
export const formatDateTime = (
  dateString: string, 
  options?: Intl.DateTimeFormatOptions
): string => {
  const timezone = getUserTimezone();
  const date = new Date(dateString);
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...options
  };
  
  return date.toLocaleString('en-US', defaultOptions);
};

/**
 * Format a date string to show only date using the user's selected timezone
 */
export const formatDate = (dateString: string): string => {
  return formatDateTime(dateString, {
    hour: undefined,
    minute: undefined,
    second: undefined
  });
};

/**
 * Format a date string to show only time using the user's selected timezone
 */
export const formatTime = (dateString: string): string => {
  return formatDateTime(dateString, {
    year: undefined,
    month: undefined,
    day: undefined
  });
};

/**
 * Format a date string for chart display based on time range
 */
export const formatChartTime = (dateString: string, timeRange: string): string | { date: string; time: string } => {
  const timezone = getUserTimezone();
  const date = new Date(dateString);
  
  if (timeRange === '1w' || timeRange === '24h') {
    return {
      date: date.toLocaleDateString('en-US', { timeZone: timezone }),
      time: date.toLocaleTimeString('en-US', { 
        timeZone: timezone,
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false
      })
    };
  } else {
    return date.toLocaleTimeString('en-US', { 
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }
};

/**
 * Format current date/time using the user's selected timezone
 */
export const formatCurrentDateTime = (): string => {
  const timezone = getUserTimezone();
  return new Date().toLocaleString('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

/**
 * Hook to listen for timezone changes and trigger re-renders
 */
export const useTimezone = (callback?: () => void) => {
  const handleTimezoneChange = () => {
    if (callback) {
      callback();
    }
  };

  // Listen for timezone changes
  if (typeof window !== 'undefined') {
    window.addEventListener('timezoneChanged', handleTimezoneChange);
    
    return () => {
      window.removeEventListener('timezoneChanged', handleTimezoneChange);
    };
  }
  
  return () => {};
};
