import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { User, AuthResponse } from '../types';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  loading: boolean;
  checkAuth: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
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

// eslint-disable-next-line react-refresh/only-export-components
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
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

  const value = {
    user,
    login,
    logout,
    loading,
    checkAuth,
    refreshToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
