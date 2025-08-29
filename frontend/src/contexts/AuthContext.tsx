import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { User, AuthResponse } from '../types';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  loading: boolean;
  checkAuth: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  recordActivity: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRefreshingRef = useRef(false);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Error checking authentication:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string, password: string): Promise<AuthResponse> => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setUser(data.user);
        return data;
      } else {
        throw new Error(data.error || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const scheduleTokenRefresh = useCallback(() => {
    // Clear existing timeout
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    
    // Schedule refresh 2 minutes before token expires (13 minutes from now)
    // Access tokens expire in 15 minutes, so refresh at 13 minutes
    refreshTimeoutRef.current = setTimeout(async () => {
      if (isRefreshingRef.current) {
        return;
      }

      isRefreshingRef.current = true;
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setUser(data.user);
            scheduleTokenRefresh(); // Schedule next refresh
          } else {
            setUser(null);
          }
        } else {
          // If refresh failed, logout user
          setUser(null);
        }
      } catch (error) {
        console.error('Error refreshing token:', error);
        setUser(null);
      } finally {
        isRefreshingRef.current = false;
      }
    }, 13 * 60 * 1000); // 13 minutes
  }, []);

  const refreshToken = useCallback(async (): Promise<boolean> => {
    if (isRefreshingRef.current) {
      return false;
    }

    isRefreshingRef.current = true;
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setUser(data.user);
          scheduleTokenRefresh(); // Schedule next refresh
          return true;
        }
      }
      
      // If refresh failed, logout user
      setUser(null);
      return false;
    } catch (error) {
      console.error('Error refreshing token:', error);
      setUser(null);
      return false;
    } finally {
      isRefreshingRef.current = false;
    }
  }, [scheduleTokenRefresh]);

  const recordActivity = useCallback(async (): Promise<void> => {
    if (!user) return;

    try {
      await fetch('/api/auth/activity', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Error recording activity:', error);
    }
  }, [user]);

  const logout = async () => {
    // Clear refresh timeout
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      setUser(null);
    }
  };

  useEffect(() => {
    checkAuth();
    
    // Cleanup timeout on unmount
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  // Schedule refresh when user is set (after login or checkAuth)
  useEffect(() => {
    if (user) {
      scheduleTokenRefresh();
    }
  }, [user, scheduleTokenRefresh]);

  // Activity tracking - record activity every 5 minutes when user is active
  useEffect(() => {
    if (!user) return;

    let activityInterval: NodeJS.Timeout;
    let lastActivityTime = Date.now();
    
    const recordPeriodicActivity = () => {
      recordActivity();
      lastActivityTime = Date.now();
    };

    // Track user interactions
    const trackActivity = () => {
      const now = Date.now();
      // Only record if last activity was more than 1 minute ago
      if (now - lastActivityTime > 60000) {
        recordActivity();
        lastActivityTime = now;
      }
    };

    // Set up periodic activity recording (every 5 minutes)
    activityInterval = setInterval(recordPeriodicActivity, 5 * 60 * 1000);

    // Track various user interactions
    const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
    events.forEach(event => {
      document.addEventListener(event, trackActivity, { passive: true });
    });

    // Cleanup
    return () => {
      if (activityInterval) {
        clearInterval(activityInterval);
      }
      events.forEach(event => {
        document.removeEventListener(event, trackActivity);
      });
    };
  }, [user, recordActivity]);

  const value = {
    user,
    login,
    logout,
    loading,
    checkAuth,
    refreshToken,
    recordActivity,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;
