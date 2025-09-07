import { LoggerService } from './logger';
import { RDAPService } from './rdap';

export interface DomainInfo {
  creationDate: Date | null;
  updatedDate: Date | null;
  expiryDate: Date | null;
  daysRemaining: number | null;
}

export interface EnhancedDomainInfo extends DomainInfo {
  registrar?: string;
  status?: string[];
  domain: string;
  tld?: string;
}

export interface DomainError {
  error: string;
  details: string;
  code?: string;
}

export class DomainInfoService {
  private rdapService: RDAPService;

  constructor(private logger: LoggerService) {
    this.rdapService = new RDAPService(logger);
  }

  /**
   * Get domain registration information using RDAP
   */
  async getDomainInfo(url: string): Promise<{ success: true; result: DomainInfo } | { success: false; error: DomainError }> {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;

      await this.logger.debug(`Starting domain info check for ${hostname}`, 'DOMAIN_INFO');

      const rdapResult = await this.rdapService.getDomainInfo(url);
      if (rdapResult.success) {
        const now = new Date();
        const daysRemaining = rdapResult.result.expiryDate ?
          Math.ceil((rdapResult.result.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

        const domain: DomainInfo = {
          creationDate: rdapResult.result.creationDate,
          updatedDate: rdapResult.result.updatedDate,
          expiryDate: rdapResult.result.expiryDate,
          daysRemaining
        };

        await this.logger.debug(`Domain info check successful for ${hostname}`, 'DOMAIN_INFO');
        return { success: true, result: domain };
      } else {
        await this.logger.warn(`RDAP domain check failed for ${hostname}: ${rdapResult.error.details}`, 'DOMAIN_INFO');
        return { success: false, error: rdapResult.error };
      }

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
      }

      const err = {
        error: 'Domain info check failed',
        details: errorMessage,
        code: errorCode
      };
      await this.logger.warn(`Domain info check failed for ${url}: ${err.details}`, 'DOMAIN_INFO');
      return { success: false, error: err };
    }
  }

  /**
   * Get enhanced domain registration information with additional RDAP data
   */
  async getEnhancedDomainInfo(url: string): Promise<{ success: true; result: EnhancedDomainInfo } | { success: false; error: DomainError }> {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;

      await this.logger.debug(`Starting enhanced domain info check for ${hostname}`, 'DOMAIN_INFO');

      const rdapResult = await this.rdapService.getDomainInfo(url);
      if (rdapResult.success) {
        const now = new Date();
        const daysRemaining = rdapResult.result.expiryDate ?
          Math.ceil((rdapResult.result.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

        // Extract domain and TLD
        const domainParts = hostname.split('.');
        const domain = domainParts.length >= 2 ? domainParts.slice(-2).join('.') : hostname;
        const tld = domainParts.length >= 2 ? domainParts[domainParts.length - 1] : '';

        const enhancedDomain: EnhancedDomainInfo = {
          creationDate: rdapResult.result.creationDate,
          updatedDate: rdapResult.result.updatedDate,
          expiryDate: rdapResult.result.expiryDate,
          daysRemaining,
          registrar: rdapResult.result.registrar,
          status: rdapResult.result.status,
          domain,
          tld
        };

        await this.logger.debug(`Enhanced domain info check successful for ${hostname}`, 'DOMAIN_INFO');
        return { success: true, result: enhancedDomain };
      } else {
        await this.logger.warn(`RDAP enhanced domain check failed for ${hostname}: ${rdapResult.error.details}`, 'DOMAIN_INFO');
        return { success: false, error: rdapResult.error };
      }

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
      }

      const err = {
        error: 'Enhanced domain info check failed',
        details: errorMessage,
        code: errorCode
      };
      await this.logger.warn(`Enhanced domain info check failed for ${url}: ${err.details}`, 'DOMAIN_INFO');
      return { success: false, error: err };
    }
  }
}
