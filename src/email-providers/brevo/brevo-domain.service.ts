import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

interface BrevoDnsRecord {
  host_name?: string;
  type?: string;
  value?: string;
  status?: boolean;
}

interface BrevoDomainConfig {
  domain: string;
  verified: boolean;
  authenticated: boolean;
  dns_records?: Record<string, BrevoDnsRecord | undefined>;
}

interface BrevoCreateDomainResponse {
  id?: number;
  domain_name?: string;
  dns_records?: Record<string, BrevoDnsRecord | undefined>;
}

type DnsRecordRow = { type: string; host: string; value: string };

@Injectable()
export class BrevoDomainService {
  private readonly logger = new Logger(BrevoDomainService.name);
  private readonly baseUrl = 'https://api.brevo.com/v3/senders/domains';

  constructor(private readonly httpService: HttpService) {}

  async authenticateDomain(
    domain: string,
    apiKey: string,
  ): Promise<{ domainId: string; dnsRecords: DnsRecordRow[]; valid: boolean }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<BrevoCreateDomainResponse>(
          this.baseUrl,
          { name: domain },
          { headers: this.headers(apiKey) },
        ),
      );

      this.logger.log(`Brevo domain created: ${domain}`);

      return {
        domainId: domain,
        dnsRecords: this.extractDnsRecords(domain, response.data?.dns_records),
        valid: false,
      };
    } catch (error) {
      const { message, status } = this.parseBrevoError(error);

      if (status === 400 && message.toLowerCase().includes('already exist')) {
        this.logger.warn(
          `Domain ${domain} already exists in Brevo — fetching existing record`,
        );
        const config = await this.getDomainConfig(domain, apiKey);
        return {
          domainId: domain,
          dnsRecords: this.extractDnsRecords(domain, config.dns_records),
          valid: config.verified && config.authenticated,
        };
      }

      this.logger.error(`Brevo domain creation failed: ${message}`);
      throw new BadGatewayException(
        `Failed to authenticate domain with Brevo: ${message}`,
      );
    }
  }

  async validateDomain(
    domainId: string,
    apiKey: string,
  ): Promise<{ valid: boolean; validationResults: any }> {
    try {
      await firstValueFrom(
        this.httpService.put(
          `${this.domainUrl(domainId)}/authenticate`,
          {},
          { headers: this.headers(apiKey) },
        ),
      );
    } catch (error) {
      const { message, status } = this.parseBrevoError(error);
      if (status !== 400) {
        this.logger.error(`Brevo domain authenticate failed: ${message}`);
        throw new BadGatewayException(
          `Failed to verify domain with Brevo: ${message}`,
        );
      }
      this.logger.debug(
        `Brevo domain ${domainId} not yet authenticated: ${message}`,
      );
    }

    const config = await this.getDomainConfig(domainId, apiKey);

    return {
      valid: config.verified && config.authenticated,
      validationResults: {
        verified: config.verified,
        authenticated: config.authenticated,
        records: Object.entries(config.dns_records ?? {}).map(
          ([name, record]) => ({
            record: name,
            valid: record?.status ?? false,
          }),
        ),
      },
    };
  }

  async deleteDomain(domainId: string, apiKey: string): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.delete(this.domainUrl(domainId), {
          headers: this.headers(apiKey),
        }),
      );
      this.logger.log(`Brevo domain deleted: ${domainId}`);
    } catch (error) {
      const { message } = this.parseBrevoError(error);
      this.logger.error(
        `Failed to delete Brevo domain ${domainId}: ${message}`,
      );
      throw new Error(message);
    }
  }

  private async getDomainConfig(
    domain: string,
    apiKey: string,
  ): Promise<BrevoDomainConfig> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<BrevoDomainConfig>(this.domainUrl(domain), {
          headers: this.headers(apiKey),
        }),
      );
      return response.data;
    } catch (error) {
      const { message } = this.parseBrevoError(error);
      this.logger.error(`Brevo domain lookup failed for ${domain}: ${message}`);
      throw new BadGatewayException(
        `Failed to retrieve domain status from Brevo: ${message}`,
      );
    }
  }

  private extractDnsRecords(
    domain: string,
    records: Record<string, BrevoDnsRecord | undefined> | undefined,
  ): DnsRecordRow[] {
    return Object.values(records ?? {}).flatMap((r) =>
      r?.type && r.value
        ? [
            {
              type: r.type,
              host: this.qualifyHost(r.host_name, domain),
              value: r.value,
            },
          ]
        : [],
    );
  }

  private qualifyHost(host: string | undefined, domain: string): string {
    if (!host || host === '@') return domain;
    if (host === domain || host.endsWith(`.${domain}`)) return host;
    return `${host}.${domain}`;
  }

  private domainUrl(domain: string): string {
    return `${this.baseUrl}/${encodeURIComponent(domain)}`;
  }

  private parseBrevoError(error: unknown): {
    message: string;
    status?: number;
  } {
    if (isAxiosError<{ message?: string }>(error)) {
      return {
        message:
          error.response?.data?.message ?? error.message ?? 'Unknown error',
        status: error.response?.status,
      };
    }
    if (error instanceof Error) {
      return { message: error.message };
    }
    return { message: String(error) };
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'api-key': apiKey,
    };
  }
}
