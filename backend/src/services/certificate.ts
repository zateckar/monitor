import tls from 'tls';
import { LoggerService } from './logger';

export interface CertificateResult {
  daysRemaining: number;
  validFrom: Date;
  validTo: Date;
  issuer: string;
  subject: string;
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
