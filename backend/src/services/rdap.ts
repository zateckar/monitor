import { LoggerService } from './logger';

export interface RDAPDomainInfo {
  creationDate: Date | null;
  updatedDate: Date | null;
  expiryDate: Date | null;
  registrar?: string;
  status?: string[];
}

export interface RDAPError {
  error: string;
  details: string;
  code?: string;
}

interface RDAPResponse {
  events?: Array<{
    eventAction: string;
    eventDate: string;
  }>;
  entities?: Array<{
    roles?: string[];
    vcardArray?: any[];
  }>;
  status?: string[];
  [key: string]: any;
}

interface TLDService {
  tlds: string[];
  rdapUrl: string;
}

export class RDAPService {
  private tldRegistry: TLDService[] = [];
  private registryLastUpdated: Date | null = null;
  private readonly REGISTRY_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private logger: LoggerService) {}

  /**
   * Get domain registration information using RDAP
   */
  async getDomainInfo(url: string): Promise<{ success: true; result: RDAPDomainInfo } | { success: false; error: RDAPError }> {
    try {
      // Parse URL to get hostname
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;

      // Extract root domain (not subdomain)
      const domain = this.extractRootDomain(hostname);

      await this.logger.debug(`Starting RDAP domain info check for ${domain}`, 'RDAP');

      // Ensure we have an up-to-date TLD registry
      await this.ensureTLDRegistry();

      // Find the appropriate RDAP server for this domain
      const rdapUrl = this.findRDAPUrl(domain);

      // Query the RDAP server
      const rdapData = await this.queryRDAP(rdapUrl, domain);

      // Parse the RDAP response
      const domainInfo = this.parseRDAPResponse(rdapData);

      await this.logger.debug(`RDAP domain info check successful for ${domain}`, 'RDAP');
      return { success: true, result: domainInfo };

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

      const err: RDAPError = {
        error: 'RDAP domain info check failed',
        details: errorMessage,
        code: errorCode
      };
      await this.logger.warn(`RDAP domain info check failed for ${url}: ${err.details}`, 'RDAP');
      return { success: false, error: err };
    }
  }

  /**
   * Ensure we have an up-to-date TLD registry from IANA
   */
  private async ensureTLDRegistry(): Promise<void> {
    const now = new Date();
    
    // Check if we need to update the registry
    if (this.registryLastUpdated && 
        (now.getTime() - this.registryLastUpdated.getTime()) < this.REGISTRY_CACHE_DURATION &&
        this.tldRegistry.length > 0) {
      return; // Registry is still fresh
    }

    await this.logger.debug('Fetching IANA RDAP registry', 'RDAP');

    try {
      const response = await fetch('https://data.iana.org/rdap/dns.json', {
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch IANA RDAP registry: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { services?: [string[], string[]][] };
      
      if (!data || !data.services || !Array.isArray(data.services)) {
        throw new Error('Invalid IANA RDAP registry format');
      }

      // Parse the registry format: [[tlds], [rdap_urls]]
      this.tldRegistry = data.services.map((service: [string[], string[]]) => {
        const rdapUrl = service[1]?.[0];
        if (!rdapUrl) {
          throw new Error('No RDAP URL found in registry entry');
        }
        return {
          tlds: service[0],
          rdapUrl: this.trimSlash(rdapUrl)
        };
      });

      this.registryLastUpdated = now;
      await this.logger.debug(`Updated IANA RDAP registry with ${this.tldRegistry.length} services`, 'RDAP');

    } catch (error) {
      await this.logger.error(`Failed to update IANA RDAP registry: ${error}`, 'RDAP');
      throw new Error(`Failed to update RDAP registry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find the appropriate RDAP URL for a given domain
   */
  private findRDAPUrl(domain: string): string {
    if (!domain) {
      throw new Error('Domain is required');
    }

    const domainParts = domain.split('.');
    const tld = domainParts[domainParts.length - 1];

    if (!tld || tld === '') {
      throw new Error('Error parsing domain TLD');
    }

    const service = this.tldRegistry.find(service => 
      service.tlds.includes(tld.toLowerCase())
    );

    if (!service) {
      throw new Error(`Unable to find RDAP server for TLD: ${tld}`);
    }

    return service.rdapUrl;
  }

  /**
   * Query the RDAP server for domain information
   */
  private async queryRDAP(rdapUrl: string, domain: string): Promise<RDAPResponse> {
    const requestUrl = `${rdapUrl}/domain/${domain}`;
    
    await this.logger.debug(`Querying RDAP: ${requestUrl}`, 'RDAP');

    try {
      const response = await fetch(requestUrl, {
        headers: {
          'Accept': 'application/rdap+json, application/json',
          'User-Agent': 'Monitor-RDAP-Client/1.0'
        },
        signal: AbortSignal.timeout(15000) // 15 second timeout
      });

      if (!response.ok) {
        throw new Error(`RDAP query failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid RDAP response format');
      }

      return data as RDAPResponse;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('RDAP query timed out');
      }
      throw error;
    }
  }

  /**
   * Parse RDAP response to extract domain information
   */
  private parseRDAPResponse(data: RDAPResponse): RDAPDomainInfo {
    const result: RDAPDomainInfo = {
      creationDate: null,
      updatedDate: null,
      expiryDate: null,
      registrar: undefined,
      status: data.status || []
    };

    // Parse events for important dates
    if (data.events && Array.isArray(data.events)) {
      for (const event of data.events) {
        if (!event.eventAction || !event.eventDate) continue;

        const date = new Date(event.eventDate);
        if (isNaN(date.getTime())) continue;

        switch (event.eventAction.toLowerCase()) {
          case 'registration':
            result.creationDate = date;
            break;
          case 'last changed':
          case 'last updated':
            result.updatedDate = date;
            break;
          case 'expiration':
            result.expiryDate = date;
            break;
        }
      }
    }

    // Extract registrar information from entities
    if (data.entities && Array.isArray(data.entities)) {
      const registrarEntity = data.entities.find(entity => 
        entity.roles && entity.roles.includes('registrar')
      );
      
      if (registrarEntity && registrarEntity.vcardArray) {
        // Parse vCard to get registrar name
        const vcard = registrarEntity.vcardArray[1];
        if (Array.isArray(vcard)) {
          const fnProperty = vcard.find((prop: any) => Array.isArray(prop) && prop[0] === 'fn');
          if (fnProperty && fnProperty[3]) {
            result.registrar = fnProperty[3];
          }
        }
      }
    }

    return result;
  }

  /**
   * Extract root domain from hostname (removes subdomains)
   * Examples: portal.skoda-api.com -> skoda-api.com, www.example.com -> example.com
   */
  private extractRootDomain(hostname: string): string {
    // Strip www. prefix first
    const cleanHost = hostname.replace(/^www\./, '');
    
    // Split by dots
    const parts = cleanHost.split('.');
    
    // If only 2 parts (domain.tld), return as is
    if (parts.length <= 2) {
      return cleanHost;
    }
    
    // For more complex cases, take the last two parts (domain.tld)
    // This works for most common TLDs but may not handle complex TLDs like .co.uk
    // For production use, consider using a proper public suffix list
    return parts.slice(-2).join('.');
  }

  /**
   * Remove trailing slash from URL
   */
  private trimSlash(input: string): string {
    return input.endsWith('/') ? input.slice(0, -1) : input;
  }
}
