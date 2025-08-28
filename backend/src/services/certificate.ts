import { LoggerService } from './logger';

export interface CertificateResult {
  daysRemaining: number;
  validFrom: Date;
  validTo: Date;
  issuer: string;
  subject: string;
}

export interface CertificateInfo {
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  daysRemaining: number;
  serialNumber: string;
  fingerprint: string;
  subjectAltNames?: string[];
  keyUsage?: string[];
  extKeyUsage?: string[];
}

export interface CertificateChain {
  certificates: CertificateInfo[];
  isValid: boolean;
  errors?: string[];
}

export interface CertificateError {
  error: string;
  details: string;
  code?: string;
}

interface ConnectionData {
  hostname: string;
  port: number;
}

export class CertificateService {
  constructor(private logger: LoggerService) {}

  async getCertificateExpiry(url: string): Promise<{ success: true; result: CertificateResult } | { success: false; error: CertificateError }> {
    try {
      // Parse and validate URL
      const parsedUrl = new URL(url);
      
      // Only check HTTPS URLs
      if (parsedUrl.protocol !== 'https:') {
        const error = {
          error: 'Non-HTTPS URL',
          details: `Certificate checking only supports HTTPS URLs. Provided: ${parsedUrl.protocol}`
        };
        await this.logger.debug(`Certificate check skipped - ${error.error}: ${error.details}`, 'CERTIFICATE');
        return { success: false, error };
      }
      await this.logger.debug(`Starting certificate check for ${url}`, 'CERTIFICATE');
      const hostname = parsedUrl.hostname;
      const port = parsedUrl.port ? parseInt(parsedUrl.port) : 443;

      // Get certificate info using Bun.connect()
      const certificateInfo = await this.getCertificateWithBunConnect(hostname, port);
      
      const now = new Date();
      const validFrom = new Date(certificateInfo.validFrom);
      const validTo = new Date(certificateInfo.validTo);
      const daysRemaining = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      const result: CertificateResult = {
        daysRemaining,
        validFrom,
        validTo,
        issuer: certificateInfo.issuer,
        subject: certificateInfo.subject
      };

      await this.logger.debug(`Certificate check successful for ${hostname}:${port} - expires in ${daysRemaining} days`, 'CERTIFICATE');
      return { success: true, result };

    } catch (error) {
      let errorMessage = 'Unknown error';
      let errorCode: string | undefined;
      
      if (error instanceof Error) {
        errorMessage = error.message;
        if ('code' in error) {
          errorCode = (error as any).code;
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else {
        errorMessage = String(error);
      }

      const err = {
        error: 'Certificate check failed',
        details: errorMessage,
        code: errorCode
      };
      await this.logger.warn(`Certificate check failed for ${url}: ${err.details}`, 'CERTIFICATE');
      return { success: false, error: err };
    }
  }

  async getCertificateChain(url: string): Promise<{ success: true; result: CertificateChain } | { success: false; error: CertificateError }> {
    try {
      // Parse and validate URL
      const parsedUrl = new URL(url);
      
      // Only check HTTPS URLs
      if (parsedUrl.protocol !== 'https:') {
        const error = {
          error: 'Non-HTTPS URL',
          details: `Certificate checking only supports HTTPS URLs. Provided: ${parsedUrl.protocol}`
        };
        await this.logger.debug(`Certificate chain check skipped - ${error.error}: ${error.details}`, 'CERTIFICATE');
        return { success: false, error };
      }

      const hostname = parsedUrl.hostname;
      const port = parsedUrl.port ? parseInt(parsedUrl.port) : 443;

      await this.logger.debug(`Starting certificate chain check for ${hostname}:${port}`, 'CERTIFICATE');

      // Get certificate info using Bun.connect()
      const certificateInfo = await this.getCertificateWithBunConnect(hostname, port);
      
      const now = new Date();
      const validFrom = new Date(certificateInfo.validFrom);
      const validTo = new Date(certificateInfo.validTo);
      const daysRemaining = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      const certificateEntry: CertificateInfo = {
        subject: certificateInfo.subject,
        issuer: certificateInfo.issuer,
        validFrom,
        validTo,
        daysRemaining,
        serialNumber: certificateInfo.serialNumber || 'Unknown',
        fingerprint: certificateInfo.fingerprint || 'Unknown',
        subjectAltNames: certificateInfo.subjectAltNames,
        keyUsage: undefined,
        extKeyUsage: undefined
      };

      // Determine if the chain is valid
      const isValid = daysRemaining > 0;
      const errors: string[] = [];

      if (daysRemaining <= 0) {
        errors.push('Certificate has expired');
      }
      if (daysRemaining <= 30) {
        errors.push('Certificate expires within 30 days');
      }

      const result: CertificateChain = {
        certificates: [certificateEntry],
        isValid,
        errors: errors.length > 0 ? errors : undefined
      };
      
      await this.logger.debug(`Certificate chain check successful for ${hostname}:${port} - found 1 certificate`, 'CERTIFICATE');
      return { success: true, result };

    } catch (error) {
      let errorMessage = 'Unknown error';
      let errorCode: string | undefined;
      
      if (error instanceof Error) {
        errorMessage = error.message;
        if ('code' in error) {
          errorCode = (error as any).code;
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else {
        errorMessage = String(error);
      }

      const err = {
        error: 'Certificate chain check failed',
        details: errorMessage,
        code: errorCode
      };
      await this.logger.warn(`Certificate chain check failed for ${url}: ${err.details}`, 'CERTIFICATE');
      return { success: false, error: err };
    }
  }

  /**
   * Get certificate information using Bun.connect() with TLS
   * Based on the proven approach from test-certificate.ts
   */
  private async getCertificateWithBunConnect(hostname: string, port: number = 443): Promise<{
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    serialNumber?: string;
    fingerprint?: string;
    subjectAltNames?: string[];
  }> {
    await this.logger.debug(`Connecting to ${hostname}:${port} using Bun.connect()`, 'CERTIFICATE');
    
    const logger = this.logger; // Capture logger reference for use in socket handlers
    
    return new Promise((resolve, reject) => {
      let resolved = false;
      
      // Set timeout for the connection
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Connection timeout after 10 seconds for ${hostname}:${port}`));
        }
      }, 10000);

      Bun.connect({
        hostname: hostname,
        port: port,
        
        // Enable TLS
        tls: {
          rejectUnauthorized: false, // Allow self-signed certificates for monitoring
          serverName: hostname
        },
        
        socket: {
          data: { hostname, port } as ConnectionData,
          
          // Handle successful connection
          open(socket: any) {
            if (resolved) return;
            
            try {
              logger.debug(`TLS connection established for ${hostname}:${port}`, 'CERTIFICATE');
              
              // Extract certificate information using Bun's native TLS socket
              if (typeof socket.getPeerCertificate === 'function') {
                try {
                  const certificate = socket.getPeerCertificate();
                  
                  if (!certificate || Object.keys(certificate).length === 0) {
                    clearTimeout(timeout);
                    resolved = true;
                    socket.end();
                    reject(new Error(`No certificate received from ${hostname}:${port}`));
                    return;
                  }

                  const subject = certificate.subject?.CN || certificate.subject?.O || hostname;
                  const issuer = certificate.issuer?.CN || certificate.issuer?.O || 'Unknown';
                  
                  // Extract subject alternative names
                  let subjectAltNames: string[] | undefined;
                  if (certificate.subjectaltname) {
                    subjectAltNames = certificate.subjectaltname.split(', ')
                      .filter((name: string) => name.startsWith('DNS:'))
                      .map((name: string) => name.substring(4));
                  }

                  const certInfo = {
                    subject,
                    issuer,
                    validFrom: certificate.valid_from,
                    validTo: certificate.valid_to,
                    serialNumber: certificate.serialNumber,
                    fingerprint: certificate.fingerprint || certificate.fingerprint256,
                    subjectAltNames
                  };

                  logger.debug(`Certificate extracted for ${hostname}: ${subject} (expires: ${certificate.valid_to})`, 'CERTIFICATE');
                  
                  clearTimeout(timeout);
                  resolved = true;
                  socket.end();
                  resolve(certInfo);
                  
                } catch (certError) {
                  clearTimeout(timeout);
                  resolved = true;
                  socket.end();
                  reject(new Error(`Failed to extract certificate from ${hostname}:${port}: ${certError}`));
                }
              } else {
                clearTimeout(timeout);
                resolved = true;
                socket.end();
                reject(new Error(`getPeerCertificate method not available for ${hostname}:${port}`));
              }
            } catch (openError) {
              clearTimeout(timeout);
              resolved = true;
              socket.end?.();
              reject(new Error(`Error in connection open handler for ${hostname}:${port}: ${openError}`));
            }
          },
          
          // Handle connection errors
          error(socket: any, error: Error) {
            if (!resolved) {
              clearTimeout(timeout);
              resolved = true;
              reject(new Error(`Connection error for ${hostname}:${port}: ${error.message}`));
            }
          },
          
          // Handle connection close
          close(socket: any) {
            // Connection closed - this is expected after we extract the certificate
          },
          
          // Handle incoming data (minimal for certificate testing)
          data(socket: any, receivedData: Buffer) {
            // We don't need to process data for certificate extraction
          }
        }
      } as any).catch((connectError: Error) => {
        if (!resolved) {
          clearTimeout(timeout);
          resolved = true;
          reject(new Error(`Failed to connect to ${hostname}:${port}: ${connectError.message}`));
        }
      });
    });
  }
}
