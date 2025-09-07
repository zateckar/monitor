/**
 * Cookie utility functions for authentication and session management
 */

// Cookie helper function
export const serializeCookie = (name: string, value: string, options: {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
  path?: string;
} = {}): string => {
  let cookie = `${name}=${value}`;

  if (options.httpOnly) cookie += '; HttpOnly';
  if (options.secure) cookie += '; Secure';
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options.path) cookie += `; Path=${options.path}`;

  return cookie;
};

// Parse cookie string into object
export const parseCookie = (cookieString: string): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!cookieString) return cookies;

  cookieString.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = rest.join('=');
    }
  });
  return cookies;
};

// Environment-aware cookie configuration
const isProduction = process.env.NODE_ENV === 'production';

// Cookie security settings based on environment
export const getCookieSecuritySettings = (forceSecure?: boolean) => {
  const shouldBeSecure = forceSecure || isProduction;
  return {
    httpOnly: true,
    secure: shouldBeSecure,
    sameSite: 'lax' as const,
    path: '/'
  };
};

// DRY helper for creating auth cookies
export const createAuthCookie = (token: string, maxAge?: number): string => {
  return serializeCookie('auth_token', token, {
    ...getCookieSecuritySettings(),
    maxAge: maxAge ?? 7 * 24 * 60 * 60, // Default 7 days
  });
};