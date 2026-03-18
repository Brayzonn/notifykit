import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface DnsRecord {
  type: string;
  host: string;
  data: string;
  valid: boolean;
}

interface DomainAuthenticationResponse {
  id: number;
  domain: string;
  subdomain: string;
  username: string;
  user_id: number;
  ips: string[];
  custom_spf: boolean;
  default: boolean;
  legacy: boolean;
  automatic_security: boolean;
  valid: boolean;
  dns: {
    mail_cname: DnsRecord;
    dkim1: DnsRecord;
    dkim2: DnsRecord;
  };
}

@Injectable()
export class SendGridDomainService {
  private readonly logger = new Logger(SendGridDomainService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.sendgrid.com/v3';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SENDGRID_API_KEY') || '';
  }

  private resolveKey(override?: string): string {
    return override || this.apiKey;
  }

  private extractDnsRecords(
    data: DomainAuthenticationResponse,
  ): Array<{ type: string; host: string; value: string }> {
    return [
      {
        type: data.dns.mail_cname.type,
        host: data.dns.mail_cname.host,
        value: data.dns.mail_cname.data,
      },
      {
        type: data.dns.dkim1.type,
        host: data.dns.dkim1.host,
        value: data.dns.dkim1.data,
      },
      {
        type: data.dns.dkim2.type,
        host: data.dns.dkim2.host,
        value: data.dns.dkim2.data,
      },
    ];
  }

  /**
   * Authenticate a domain in SendGrid.
   * If the domain + subdomain already exists in SendGrid (e.g. from a
   * previous attempt that failed before saving to DB), fetch the existing
   * record and return it instead of erroring.
   */
  async authenticateDomain(domain: string, apiKey?: string): Promise<{
    domainId: number;
    dnsRecords: Array<{ type: string; host: string; value: string }>;
    valid: boolean;
  }> {
    try {
      const response = await axios.post<DomainAuthenticationResponse>(
        `${this.baseUrl}/whitelabel/domains`,
        {
          domain: domain,
          subdomain: 'em',
          automatic_security: true,
          default: false,
          custom_spf: false,
        },
        {
          headers: {
            Authorization: `Bearer ${this.resolveKey(apiKey)}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Domain authentication initiated for: ${domain}`);

      return {
        domainId: response.data.id,
        dnsRecords: this.extractDnsRecords(response.data),
        valid: response.data.valid,
      };
    } catch (error) {
      const sgMessage: string =
        error.response?.data?.errors?.[0]?.message || '';

      if (
        error.response?.status === 400 &&
        sgMessage.toLowerCase().includes('already exists')
      ) {
        this.logger.warn(
          `Domain em.${domain} already exists in SendGrid — fetching existing record`,
        );
        return this.findExistingDomain(domain, apiKey);
      }

      this.logger.error(
        `SendGrid domain authentication failed: ${error.message}`,
      );
      throw new BadGatewayException(
        `Failed to authenticate domain: ${sgMessage || error.message}`,
      );
    }
  }

  /**
   * Look up an existing authenticated domain in SendGrid by domain name.
   */
  private async findExistingDomain(domain: string, apiKey?: string): Promise<{
    domainId: number;
    dnsRecords: Array<{ type: string; host: string; value: string }>;
    valid: boolean;
  }> {
    try {
      const response = await axios.get<DomainAuthenticationResponse[]>(
        `${this.baseUrl}/whitelabel/domains`,
        {
          params: { domain },
          headers: { Authorization: `Bearer ${this.resolveKey(apiKey)}` },
        },
      );

      const existing = response.data.find(
        (d) => d.domain === domain && d.subdomain === 'em',
      );

      if (!existing) {
        throw new BadGatewayException(
          `Domain em.${domain} exists in SendGrid but could not be retrieved`,
        );
      }

      this.logger.log(`Retrieved existing SendGrid domain record for: ${domain}`);

      return {
        domainId: existing.id,
        dnsRecords: this.extractDnsRecords(existing),
        valid: existing.valid,
      };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(
        `Failed to retrieve existing domain: ${error.message}`,
      );
    }
  }

  /**
   * Validate domain DNS records
   */
  async validateDomain(domainId: number, apiKey?: string): Promise<{
    valid: boolean;
    validationResults: any;
  }> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/whitelabel/domains/${domainId}/validate`,
        {},
        {
          headers: {
            Authorization: `Bearer ${this.resolveKey(apiKey)}`,
          },
        },
      );

      this.logger.log(
        `Domain validation result: ${response.data.valid ? 'Success' : 'Failed'}`,
      );

      return {
        valid: response.data.valid,
        validationResults: response.data.validation_results,
      };
    } catch (error) {
      this.logger.error(`SendGrid domain validation failed: ${error.message}`);
      throw new BadGatewayException(
        `Failed to validate domain: ${error.response?.data?.errors?.[0]?.message || error.message}`,
      );
    }
  }

  /**
   * Get domain details
   */
  async getDomain(domainId: number) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/whitelabel/domains/${domainId}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get domain details: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete domain authentication
   */
  async deleteDomain(domainId: number, apiKey?: string) {
    try {
      await axios.delete(`${this.baseUrl}/whitelabel/domains/${domainId}`, {
        headers: {
          Authorization: `Bearer ${this.resolveKey(apiKey)}`,
        },
      });

      this.logger.log(`Domain deleted: ${domainId}`);
    } catch (error) {
      this.logger.error(`Failed to delete domain: ${error.message}`);
      throw error;
    }
  }
}
