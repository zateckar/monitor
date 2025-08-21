import tls from 'tls';
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

      const hostname = parsedUrl.hostname;
      const port = parsedUrl.port ? parseInt(parsedUrl.port) : 443;

      await this.logger.debug(`Starting certificate check for ${hostname}:${port}`, 'CERTIFICATE');

      // Get certificate info using simplified approach
      const certificateInfo = await this.getCertificateInfo(hostname, port);
      
      const now = new Date();
      const validFrom = new Date(certificateInfo.valid_from);
      const validTo = new Date(certificateInfo.valid_to);
      const daysRemaining = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Extract issuer and subject info safely
      const issuer = (certificateInfo.issuer && (certificateInfo.issuer.CN || certificateInfo.issuer.O)) || 'Unknown';
      const subject = (certificateInfo.subject && (certificateInfo.subject.CN || certificateInfo.subject.O)) || hostname;

      const result: CertificateResult = {
        daysRemaining,
        validFrom,
        validTo,
        issuer,
        subject
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

      const certificateChain = await this.getCertificateChainInfo(hostname, port);
      
      await this.logger.debug(`Certificate chain check successful for ${hostname}:${port} - found ${certificateChain.certificates.length} certificates`, 'CERTIFICATE');
      return { success: true, result: certificateChain };

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
   * Get the full certificate chain information for a hostname
   */
  private getCertificateChainInfo(hostname: string, port: number = 443): Promise<CertificateChain> {
    return new Promise((resolve, reject) => {
      const options = {
        host: hostname,
        port: port,
        servername: hostname,
        rejectUnauthorized: false, // Don't reject self-signed certs, we want to examine them
      };

      const socket = tls.connect(options, () => {
        try {
          const peerCert = socket.getPeerCertificate(true); // true = include issuer chain
          socket.end();

          if (!peerCert || Object.keys(peerCert).length === 0) {
            return reject(new Error(`No certificate found for ${hostname}`));
          }

          const certificates: CertificateInfo[] = [];
          const now = new Date();

          // Process the certificate chain
          let currentCert = peerCert;
          while (currentCert) {
            const validFrom = new Date(currentCert.valid_from);
            const validTo = new Date(currentCert.valid_to);
            const daysRemaining = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

            // Extract subject and issuer information
            const subjectCN = currentCert.subject?.CN || 'Unknown';
            const subjectO = currentCert.subject?.O || '';
            const issuerCN = currentCert.issuer?.CN || 'Unknown';
            const issuerO = currentCert.issuer?.O || '';

            const subjectStr = subjectO ? `${subjectCN} (${subjectO})` : subjectCN;
            const issuerStr = issuerO ? `${issuerCN} (${issuerO})` : issuerCN;

            // Extract Subject Alternative Names
            const subjectAltNames: string[] = [];
            if (currentCert.subjectaltname) {
              const altNames = currentCert.subjectaltname.split(', ');
              altNames.forEach(name => {
                if (name.startsWith('DNS:')) {
                  subjectAltNames.push(name.substring(4));
                } else if (name.startsWith('IP Address:')) {
                  subjectAltNames.push(name.substring(11));
                }
              });
            }

            // Extract key usage extensions
            const keyUsage: string[] = [];
            const extKeyUsage: string[] = [];
            
            if (currentCert.ext_key_usage) {
              extKeyUsage.push(...currentCert.ext_key_usage);
            }

            certificates.push({
              subject: subjectStr,
              issuer: issuerStr,
              validFrom,
              validTo,
              daysRemaining,
              serialNumber: currentCert.serialNumber || 'Unknown',
              fingerprint: currentCert.fingerprint || 'Unknown',
              subjectAltNames: subjectAltNames.length > 0 ? subjectAltNames : undefined,
              keyUsage: keyUsage.length > 0 ? keyUsage : undefined,
              extKeyUsage: extKeyUsage.length > 0 ? extKeyUsage : undefined
            });

            // Move to the next certificate in the chain
            if (currentCert.issuerCertificate && currentCert.issuerCertificate !== currentCert) {
              currentCert = currentCert.issuerCertificate;
            } else {
              break;
            }
          }

          // Determine if the chain is valid (simplified check)
          const isValid = certificates.length > 0 && (certificates[0]?.daysRemaining || 0) > 0;
          const errors: string[] = [];

          const firstCert = certificates[0];
          if (firstCert && firstCert.daysRemaining <= 0) {
            errors.push('Certificate has expired');
          }
          if (firstCert && firstCert.daysRemaining <= 30) {
            errors.push('Certificate expires within 30 days');
          }

          resolve({
            certificates,
            isValid,
            errors: errors.length > 0 ? errors : undefined
          });

        } catch (error) {
          reject(error);
        }
      });

      socket.on('error', reject);
    });
  }

  /**
   * Get certificate information for a hostname (simplified approach based on certwatch-js)
   */
  private getCertificateInfo(hostname: string, port: number = 443): Promise<any> {
    return new Promise((resolve, reject) => {
      const options = {
        host: hostname,
        port: port,
        servername: hostname,
        rejectUnauthorized: false, // Don't reject self-signed certs, we just want expiry info
      };

      const socket = tls.connect(options, () => {
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert || Object.keys(cert).length === 0) {
          return reject(new Error(`No certificate found for ${hostname}`));
        }

        resolve({
          subject: cert.subject,
          issuer: cert.issuer,
          valid_from: cert.valid_from,
          valid_to: cert.valid_to,
        });
      });

      socket.on('error', reject);
    });
  }

}
