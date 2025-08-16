import { URL } from 'url';

// Maximum field lengths to prevent DoS attacks
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

// Dangerous characters that should be escaped or rejected
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
  sanitizedValue?: any;
}

/**
 * Validates and sanitizes a URL for security
 */
export function validateUrl(url: string, allowedProtocols: string[] = ALLOWED_PROTOCOLS): ValidationResult {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: 'URL is required and must be a string' };
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
    
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      return { 
        isValid: false, 
        error: `Protocol '${parsedUrl.protocol}' not allowed. Allowed protocols: ${allowedProtocols.join(', ')}` 
      };
    }

    // Additional security checks
    if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
      // Allow localhost for development, but log it
      console.warn(`Warning: localhost URL detected: ${url}`);
    }

    return { isValid: true, sanitizedValue: url.trim() };
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validates and sanitizes text input for XSS prevention
 */
export function validateAndSanitizeText(text: string, maxLength: number, fieldName: string): ValidationResult {
  if (text && typeof text !== 'string') {
    return { isValid: false, error: `${fieldName} must be a string` };
  }

  if (!text) {
    return { isValid: true, sanitizedValue: null };
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

  // HTML escape the text
  const sanitized = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();

  return { isValid: true, sanitizedValue: sanitized };
}

/**
 * Validates JSON string and structure
 */
export function validateJsonString(jsonString: string, maxLength: number, fieldName: string): ValidationResult {
  if (!jsonString) {
    return { isValid: true, sanitizedValue: null };
  }

  if (typeof jsonString !== 'string') {
    return { isValid: false, error: `${fieldName} must be a string` };
  }

  if (jsonString.length > maxLength) {
    return { isValid: false, error: `${fieldName} exceeds maximum length of ${maxLength} characters` };
  }

  try {
    const parsed = JSON.parse(jsonString);
    
    // Additional validation for specific JSON structures
    if (fieldName.toLowerCase().includes('header')) {
      return validateHttpHeaders(parsed, fieldName);
    }

    return { isValid: true, sanitizedValue: parsed };
  } catch (error) {
    return { isValid: false, error: `Invalid JSON format in ${fieldName}` };
  }
}

/**
 * Validates HTTP headers object
 */
export function validateHttpHeaders(headers: any, fieldName: string): ValidationResult {
  if (!headers || typeof headers !== 'object') {
    return { isValid: false, error: `${fieldName} must be an object` };
  }

  const sanitizedHeaders: { [key: string]: string } = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      return { isValid: false, error: `${fieldName} keys and values must be strings` };
    }

    // Check for header injection attacks
    if (key.includes('\r') || key.includes('\n') || value.includes('\r') || value.includes('\n')) {
      return { isValid: false, error: `${fieldName} contains invalid characters (CRLF injection attempt)` };
    }

    // Validate header name format
    if (!/^[a-zA-Z0-9\-_]+$/.test(key)) {
      return { isValid: false, error: `Invalid header name: ${key}` };
    }

    // Sanitize header value
    const sanitizedValue = value.replace(/[\r\n]/g, '').trim();
    if (sanitizedValue.length > 1000) {
      return { isValid: false, error: `Header value too long: ${key}` };
    }

    sanitizedHeaders[key] = sanitizedValue;
  }

  return { isValid: true, sanitizedValue: sanitizedHeaders };
}

/**
 * Validates email format
 */
export function validateEmail(email: string): ValidationResult {
  if (!email) {
    return { isValid: true, sanitizedValue: null };
  }

  if (typeof email !== 'string') {
    return { isValid: false, error: 'Email must be a string' };
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
 * Validates certificate in PEM format
 */
export function validateCertificate(cert: string, fieldName: string): ValidationResult {
  if (!cert) {
    return { isValid: true, sanitizedValue: null };
  }

  if (typeof cert !== 'string') {
    return { isValid: false, error: `${fieldName} must be a string` };
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
 * Validates private key in PEM format
 */
export function validatePrivateKey(key: string, fieldName: string): ValidationResult {
  if (!key) {
    return { isValid: true, sanitizedValue: null };
  }

  if (typeof key !== 'string') {
    return { isValid: false, error: `${fieldName} must be a string` };
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
export function validateNumber(value: any, min: number, max: number, fieldName: string): ValidationResult {
  if (value === null || value === undefined) {
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
export function validatePort(port: any): ValidationResult {
  if (port === null || port === undefined || port === '') {
    return { isValid: true, sanitizedValue: null };
  }

  return validateNumber(port, 1, 65535, 'Port');
}

/**
 * Validates array of HTTP status codes
 */
export function validateHttpStatusCodes(statuses: any): ValidationResult {
  if (!statuses || statuses.length === 0) {
    return { isValid: true, sanitizedValue: null };
  }

  if (!Array.isArray(statuses)) {
    return { isValid: false, error: 'HTTP status codes must be an array' };
  }

  const validatedStatuses: number[] = [];
  for (const status of statuses) {
    const statusValidation = validateNumber(status, 100, 599, 'HTTP status code');
    if (!statusValidation.isValid) {
      return statusValidation;
    }
    validatedStatuses.push(statusValidation.sanitizedValue!);
  }

  return { isValid: true, sanitizedValue: validatedStatuses };
}

/**
 * Comprehensive endpoint validation
 */
export function validateEndpoint(data: any): ValidationResult {
  const errors: string[] = [];
  const sanitizedData: any = {};

  // Validate URL
  const urlValidation = validateUrl(data.url);
  if (!urlValidation.isValid) {
    errors.push(urlValidation.error!);
  } else {
    sanitizedData.url = urlValidation.sanitizedValue;
  }

  // Validate name
  const nameValidation = validateAndSanitizeText(data.name || data.url, MAX_LENGTHS.NAME, 'Name');
  if (!nameValidation.isValid) {
    errors.push(nameValidation.error!);
  } else {
    sanitizedData.name = nameValidation.sanitizedValue;
  }

  // Validate type
  const validTypes = ['http', 'ping', 'tcp', 'kafka_producer', 'kafka_consumer'];
  if (!data.type || !validTypes.includes(data.type)) {
    errors.push(`Type must be one of: ${validTypes.join(', ')}`);
  } else {
    sanitizedData.type = data.type;
  }

  // Validate heartbeat interval
  const heartbeatValidation = validateNumber(data.heartbeat_interval || 60, 10, 86400, 'Heartbeat interval');
  if (!heartbeatValidation.isValid) {
    errors.push(heartbeatValidation.error!);
  } else {
    sanitizedData.heartbeat_interval = heartbeatValidation.sanitizedValue;
  }

  // Validate retries
  const retriesValidation = validateNumber(data.retries || 3, 0, 10, 'Retries');
  if (!retriesValidation.isValid) {
    errors.push(retriesValidation.error!);
  } else {
    sanitizedData.retries = retriesValidation.sanitizedValue;
  }

  // Validate HTTP-specific fields
  if (data.type === 'http') {
    if (data.http_headers) {
      const headersValidation = validateJsonString(data.http_headers, MAX_LENGTHS.HTTP_HEADERS, 'HTTP headers');
      if (!headersValidation.isValid) {
        errors.push(headersValidation.error!);
      } else {
        sanitizedData.http_headers = headersValidation.sanitizedValue;
      }
    }

    if (data.http_body) {
      const bodyValidation = validateAndSanitizeText(data.http_body, MAX_LENGTHS.HTTP_BODY, 'HTTP body');
      if (!bodyValidation.isValid) {
        errors.push(bodyValidation.error!);
      } else {
        sanitizedData.http_body = bodyValidation.sanitizedValue;
      }
    }

    if (data.ok_http_statuses) {
      const statusValidation = validateHttpStatusCodes(data.ok_http_statuses);
      if (!statusValidation.isValid) {
        errors.push(statusValidation.error!);
      } else {
        sanitizedData.ok_http_statuses = statusValidation.sanitizedValue;
      }
    }

    if (data.keyword_search) {
      const keywordValidation = validateAndSanitizeText(data.keyword_search, MAX_LENGTHS.KEYWORD_SEARCH, 'Keyword search');
      if (!keywordValidation.isValid) {
        errors.push(keywordValidation.error!);
      } else {
        sanitizedData.keyword_search = keywordValidation.sanitizedValue;
      }
    }
  }

  // Validate TCP-specific fields
  if (data.type === 'tcp' && data.tcp_port) {
    const portValidation = validatePort(data.tcp_port);
    if (!portValidation.isValid) {
      errors.push(portValidation.error!);
    } else {
      sanitizedData.tcp_port = portValidation.sanitizedValue;
    }
  }

  // Validate Kafka-specific fields
  if ((data.type === 'kafka_producer' || data.type === 'kafka_consumer')) {
    if (!data.kafka_topic) {
      errors.push('Kafka topic is required for Kafka monitors');
    } else {
      const topicValidation = validateAndSanitizeText(data.kafka_topic, 255, 'Kafka topic');
      if (!topicValidation.isValid) {
        errors.push(topicValidation.error!);
      } else {
        sanitizedData.kafka_topic = topicValidation.sanitizedValue;
      }
    }

    if (data.kafka_config) {
      const configValidation = validateJsonString(data.kafka_config, MAX_LENGTHS.KAFKA_CONFIG, 'Kafka config');
      if (!configValidation.isValid) {
        errors.push(configValidation.error!);
      } else {
        sanitizedData.kafka_config = configValidation.sanitizedValue;
      }
    }

    if (data.kafka_message) {
      const messageValidation = validateAndSanitizeText(data.kafka_message, MAX_LENGTHS.KAFKA_MESSAGE, 'Kafka message');
      if (!messageValidation.isValid) {
        errors.push(messageValidation.error!);
      } else {
        sanitizedData.kafka_message = messageValidation.sanitizedValue;
      }
    }
  }

  // Validate mTLS certificates
  if (data.client_cert_enabled) {
    if (data.client_cert_public_key) {
      const certValidation = validateCertificate(data.client_cert_public_key, 'Client certificate');
      if (!certValidation.isValid) {
        errors.push(certValidation.error!);
      } else {
        sanitizedData.client_cert_public_key = certValidation.sanitizedValue;
      }
    }

    if (data.client_cert_private_key) {
      const keyValidation = validatePrivateKey(data.client_cert_private_key, 'Private key');
      if (!keyValidation.isValid) {
        errors.push(keyValidation.error!);
      } else {
        sanitizedData.client_cert_private_key = keyValidation.sanitizedValue;
      }
    }

    if (data.client_cert_ca) {
      const caValidation = validateCertificate(data.client_cert_ca, 'CA certificate');
      if (!caValidation.isValid) {
        errors.push(caValidation.error!);
      } else {
        sanitizedData.client_cert_ca = caValidation.sanitizedValue;
      }
    }
  }

  if (errors.length > 0) {
    return { isValid: false, error: errors.join('; ') };
  }

  return { isValid: true, sanitizedValue: sanitizedData };
}
