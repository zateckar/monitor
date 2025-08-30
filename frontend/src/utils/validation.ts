// Frontend validation utilities for XSS prevention and input sanitization

export const MAX_LENGTHS = {
  URL: 2048,
  NAME: 255,
  DESCRIPTION: 1000,
  HTTP_BODY: 10000,
  HTTP_HEADERS: 5000,
  KAFKA_CONFIG: 5000,
  KAFKA_MESSAGE: 10000,
  CERTIFICATE: 50000,
  PRIVATE_KEY: 50000,
  KEYWORD_SEARCH: 500,
  EMAIL: 320,
  WEBHOOK_URL: 2048,
  API_KEY: 1000,
  TOKEN: 2000
};

// Allowed URL protocols for security
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'tcp:'];

// Dangerous patterns that should be escaped or rejected
const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /data:text\/html/gi,
  /vbscript:/gi,
  /on\w+\s*=/gi
];

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedValue?: unknown;
}

/**
 * Sanitizes text input to prevent XSS attacks
 */
export function sanitizeText(text: string): string {
  if (!text) return '';
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

/**
 * Validates URL format and security
 */
export function validateUrl(url: string): ValidationResult {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: 'URL is required' };
  }

  if (url.length > MAX_LENGTHS.URL) {
    return { isValid: false, error: `URL exceeds maximum length of ${MAX_LENGTHS.URL} characters` };
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(url)) {
      return { isValid: false, error: 'URL contains potentially dangerous content' };
    }
  }

  try {
    const parsedUrl = new URL(url);
    
    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
      return { 
        isValid: false, 
        error: `Protocol '${parsedUrl.protocol}' not allowed. Allowed protocols: ${ALLOWED_PROTOCOLS.join(', ')}` 
      };
    }

    return { isValid: true, sanitizedValue: url.trim() };
  } catch {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validates and sanitizes text input
 */
export function validateText(text: string, maxLength: number, fieldName: string): ValidationResult {
  if (!text) {
    return { isValid: true, sanitizedValue: '' };
  }

  if (typeof text !== 'string') {
    return { isValid: false, error: `${fieldName} must be text` };
  }

  if (text.length > maxLength) {
    return { isValid: false, error: `${fieldName} exceeds maximum length of ${maxLength} characters` };
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      return { isValid: false, error: `${fieldName} contains potentially dangerous content` };
    }
  }

  return { isValid: true, sanitizedValue: sanitizeText(text) };
}

/**
 * Validates JSON string format
 */
export function validateJson(jsonString: string, fieldName: string): ValidationResult {
  if (!jsonString || !jsonString.trim()) {
    return { isValid: true, sanitizedValue: null };
  }

  try {
    const parsed = JSON.parse(jsonString);
    return { isValid: true, sanitizedValue: parsed };
  } catch {
    return { isValid: false, error: `Invalid JSON format in ${fieldName}` };
  }
}

/**
 * Validates HTTP headers JSON structure
 */
export function validateHttpHeaders(headers: string): ValidationResult {
  if (!headers || !headers.trim()) {
    return { isValid: true, sanitizedValue: null };
  }

  const jsonValidation = validateJson(headers, 'HTTP headers');
  if (!jsonValidation.isValid) {
    return jsonValidation;
  }

  const parsed = jsonValidation.sanitizedValue;
  if (!parsed || typeof parsed !== 'object') {
    return { isValid: false, error: 'HTTP headers must be a valid JSON object' };
  }

  // Validate header structure
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      return { isValid: false, error: 'HTTP header keys and values must be strings' };
    }

    // Check for header injection attacks
    if (key.includes('\r') || key.includes('\n') || value.includes('\r') || value.includes('\n')) {
      return { isValid: false, error: 'HTTP headers contain invalid characters (CRLF injection attempt)' };
    }

    // Validate header name format
    if (!/^[a-zA-Z0-9\-_]+$/.test(key)) {
      return { isValid: false, error: `Invalid header name: ${key}` };
    }

    if (value.length > 1000) {
      return { isValid: false, error: `Header value too long: ${key}` };
    }
  }

  return { isValid: true, sanitizedValue: parsed };
}

/**
 * Validates email format
 */
export function validateEmail(email: string): ValidationResult {
  if (!email) {
    return { isValid: true, sanitizedValue: null };
  }

  if (typeof email !== 'string') {
    return { isValid: false, error: 'Email must be text' };
  }

  if (email.length > MAX_LENGTHS.EMAIL) {
    return { isValid: false, error: `Email exceeds maximum length of ${MAX_LENGTHS.EMAIL} characters` };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: 'Invalid email format' };
  }

  return { isValid: true, sanitizedValue: email.toLowerCase().trim() };
}

/**
 * Validates certificate format
 */
export function validateCertificate(cert: string, fieldName: string): ValidationResult {
  if (!cert) {
    return { isValid: true, sanitizedValue: null };
  }

  if (typeof cert !== 'string') {
    return { isValid: false, error: `${fieldName} must be text` };
  }

  if (cert.length > MAX_LENGTHS.CERTIFICATE) {
    return { isValid: false, error: `${fieldName} exceeds maximum length of ${MAX_LENGTHS.CERTIFICATE} characters` };
  }

  // Basic PEM format validation
  const pemRegex = /^-----BEGIN [A-Z\s]+-----[\s\S]*-----END [A-Z\s]+-----$/;
  if (!pemRegex.test(cert.trim())) {
    return { isValid: false, error: `${fieldName} is not in valid PEM format` };
  }

  // Check for dangerous content
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cert)) {
      return { isValid: false, error: `${fieldName} contains potentially dangerous content` };
    }
  }

  return { isValid: true, sanitizedValue: cert.trim() };
}

/**
 * Validates private key format
 */
export function validatePrivateKey(key: string, fieldName: string): ValidationResult {
  if (!key) {
    return { isValid: true, sanitizedValue: null };
  }

  if (typeof key !== 'string') {
    return { isValid: false, error: `${fieldName} must be text` };
  }

  if (key.length > MAX_LENGTHS.PRIVATE_KEY) {
    return { isValid: false, error: `${fieldName} exceeds maximum length of ${MAX_LENGTHS.PRIVATE_KEY} characters` };
  }

  // Basic PEM format validation for private keys
  const privateKeyRegex = /^-----BEGIN [A-Z\s]*PRIVATE KEY-----[\s\S]*-----END [A-Z\s]*PRIVATE KEY-----$/;
  if (!privateKeyRegex.test(key.trim())) {
    return { isValid: false, error: `${fieldName} is not in valid PEM private key format` };
  }

  return { isValid: true, sanitizedValue: key.trim() };
}

/**
 * Validates numeric input with bounds
 */
export function validateNumber(value: unknown, min: number, max: number, fieldName: string): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return { isValid: false, error: `${fieldName} is required` };
  }

  const num = Number(value);
  if (isNaN(num)) {
    return { isValid: false, error: `${fieldName} must be a valid number` };
  }

  if (num < min || num > max) {
    return { isValid: false, error: `${fieldName} must be between ${min} and ${max}` };
  }

  return { isValid: true, sanitizedValue: Math.floor(num) };
}

/**
 * Validates optional port number
 */
export function validatePort(port: unknown): ValidationResult {
  if (port === null || port === undefined || port === '') {
    return { isValid: true, sanitizedValue: null };
  }

  return validateNumber(port, 1, 65535, 'Port');
}

/**
 * Validates HTTP status codes
 */
export function validateHttpStatuses(statuses: string): ValidationResult {
  if (!statuses || !statuses.trim()) {
    return { isValid: true, sanitizedValue: [] };
  }

  // Split by comma and validate each status code
  const statusArray = statuses.split(',').map(s => s.trim()).filter(s => s);
  const validatedStatuses: number[] = [];

  for (const status of statusArray) {
    const statusValidation = validateNumber(status, 100, 599, 'HTTP status code');
    if (!statusValidation.isValid) {
      return statusValidation;
    }
    validatedStatuses.push(statusValidation.sanitizedValue as number);
  }

  return { isValid: true, sanitizedValue: validatedStatuses };
}

/**
 * Real-time validation hook for form fields
 */
export function useFieldValidation() {
  const validateField = (value: unknown, type: string, fieldName: string): ValidationResult => {
    // Convert value to string for string-based validations
    const stringValue = typeof value === 'string' ? value : String(value || '');
    
    switch (type) {
      case 'url':
        return validateUrl(stringValue);
      case 'text':
        return validateText(stringValue, MAX_LENGTHS.NAME, fieldName);
      case 'longtext':
        return validateText(stringValue, MAX_LENGTHS.DESCRIPTION, fieldName);
      case 'json':
        return validateJson(stringValue, fieldName);
      case 'headers':
        return validateHttpHeaders(stringValue);
      case 'email':
        return validateEmail(stringValue);
      case 'certificate':
        return validateCertificate(stringValue, fieldName);
      case 'privatekey':
        return validatePrivateKey(stringValue, fieldName);
      case 'number':
        return validateNumber(value, 1, 86400, fieldName);
      case 'port':
        return validatePort(value);
      case 'statuses':
        return validateHttpStatuses(stringValue);
      default:
        return { isValid: true, sanitizedValue: value };
    }
  };

  return { validateField };
}

/**
 * Escapes HTML content for safe display
 */
export function escapeHtml(html: string): string {
  if (!html) return '';
  
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
}

/**
 * Sanitizes user input for display
 */
export function sanitizeForDisplay(text: string): string {
  if (!text) return '';
  
  // First escape HTML
  const escaped = escapeHtml(text);
  
  // Then check for dangerous patterns and warn
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      console.warn('Potentially dangerous content detected and sanitized:', text);
      break;
    }
  }
  
  return escaped;
}
