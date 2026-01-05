import { Injectable, Logger } from '@nestjs/common';
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

  /**
   * Authenticate a domain in SendGrid
   */
  async authenticateDomain(domain: string): Promise<{
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
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const data = response.data;

      const dnsRecords = [
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

      this.logger.log(`Domain authentication initiated for: ${domain}`);

      return {
        domainId: data.id,
        dnsRecords,
        valid: data.valid,
      };
    } catch (error) {
      this.logger.error(
        `SendGrid domain authentication failed: ${error.message}`,
      );
      throw new Error(
        `Failed to authenticate domain: ${error.response?.data?.errors?.[0]?.message || error.message}`,
      );
    }
  }

  /**
   * Validate domain DNS records
   */
  async validateDomain(domainId: number): Promise<{
    valid: boolean;
    validationResults: any;
  }> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/whitelabel/domains/${domainId}/validate`,
        {},
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
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
      throw new Error(
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
  async deleteDomain(domainId: number) {
    try {
      await axios.delete(`${this.baseUrl}/whitelabel/domains/${domainId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      this.logger.log(`Domain deleted: ${domainId}`);
    } catch (error) {
      this.logger.error(`Failed to delete domain: ${error.message}`);
      throw error;
    }
  }
}
