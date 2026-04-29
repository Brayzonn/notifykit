import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

interface PostmarkDomain {
  ID: number;
  Name: string;
  DKIMVerified: boolean;
  ReturnPathDomainVerified: boolean;
  DKIMHost?: string;
  DKIMTextValue?: string;
  ReturnPathDomain?: string;
  ReturnPathDomainCNAMEValue?: string;
}

@Injectable()
export class PostmarkDomainService {
  private readonly logger = new Logger(PostmarkDomainService.name);
  private readonly baseUrl = 'https://api.postmarkapp.com';

  constructor(private readonly httpService: HttpService) {}

  /**
   * Register a domain with Postmark and return its DNS records.
   * Postmark domain endpoints require an Account Token (not a Server Token).
   */
  async authenticateDomain(
    domain: string,
    accountToken: string,
  ): Promise<{
    domainId: string;
    dnsRecords: Array<{ type: string; host: string; value: string }>;
    valid: boolean;
  }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<PostmarkDomain>(
          `${this.baseUrl}/domains`,
          { Name: domain },
          { headers: this.headers(accountToken) },
        ),
      );

      const data = response.data;
      this.logger.log(`Postmark domain created: ${domain} (${data.ID})`);

      return {
        domainId: data.ID.toString(),
        dnsRecords: this.extractDnsRecords(data),
        valid: data.DKIMVerified && data.ReturnPathDomainVerified,
      };
    } catch (error) {
      const { message, status } = this.parsePostmarkError(error);

      if (
        status === 422 &&
        typeof message === 'string' &&
        message.toLowerCase().includes('already')
      ) {
        this.logger.warn(
          `Domain ${domain} already exists in Postmark — fetching existing record`,
        );
        return this.findExistingDomain(domain, accountToken);
      }

      this.logger.error(`Postmark domain creation failed: ${message}`);
      throw new BadGatewayException(
        `Failed to authenticate domain with Postmark: ${message}`,
      );
    }
  }

  async validateDomain(
    domainId: string,
    accountToken: string,
  ): Promise<{ valid: boolean; validationResults: any }> {
    try {
      await firstValueFrom(
        this.httpService.put(
          `${this.baseUrl}/domains/${domainId}/verifyDkim`,
          {},
          { headers: this.headers(accountToken) },
        ),
      );
      await firstValueFrom(
        this.httpService.put(
          `${this.baseUrl}/domains/${domainId}/verifyReturnPath`,
          {},
          { headers: this.headers(accountToken) },
        ),
      );

      const response = await firstValueFrom(
        this.httpService.get<PostmarkDomain>(
          `${this.baseUrl}/domains/${domainId}`,
          { headers: this.headers(accountToken) },
        ),
      );

      const data = response.data;
      return {
        valid: data.DKIMVerified && data.ReturnPathDomainVerified,
        validationResults: {
          dkim: data.DKIMVerified,
          returnPath: data.ReturnPathDomainVerified,
        },
      };
    } catch (error) {
      const { message } = this.parsePostmarkError(error);
      this.logger.error(`Postmark domain verify failed: ${message}`);
      throw new BadGatewayException(
        `Failed to verify domain with Postmark: ${message}`,
      );
    }
  }

  async deleteDomain(domainId: string, accountToken: string): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.delete(`${this.baseUrl}/domains/${domainId}`, {
          headers: this.headers(accountToken),
        }),
      );
      this.logger.log(`Postmark domain deleted: ${domainId}`);
    } catch (error) {
      const { message } = this.parsePostmarkError(error);
      this.logger.error(
        `Failed to delete Postmark domain ${domainId}: ${message}`,
      );
      throw new Error(message);
    }
  }

  private async findExistingDomain(
    domain: string,
    accountToken: string,
  ): Promise<{
    domainId: string;
    dnsRecords: Array<{ type: string; host: string; value: string }>;
    valid: boolean;
  }> {
    const listResponse = await firstValueFrom(
      this.httpService.get<{ Domains: Array<{ ID: number; Name: string }> }>(
        `${this.baseUrl}/domains?count=500&offset=0`,
        { headers: this.headers(accountToken) },
      ),
    );

    const existing = listResponse.data?.Domains?.find((d) => d.Name === domain);
    if (!existing) {
      throw new BadGatewayException(
        `Domain ${domain} exists in Postmark but could not be retrieved`,
      );
    }

    const detailResponse = await firstValueFrom(
      this.httpService.get<PostmarkDomain>(
        `${this.baseUrl}/domains/${existing.ID}`,
        { headers: this.headers(accountToken) },
      ),
    );

    const data = detailResponse.data;
    return {
      domainId: data.ID.toString(),
      dnsRecords: this.extractDnsRecords(data),
      valid: data.DKIMVerified && data.ReturnPathDomainVerified,
    };
  }

  private extractDnsRecords(
    data: PostmarkDomain,
  ): Array<{ type: string; host: string; value: string }> {
    const records: Array<{ type: string; host: string; value: string }> = [];

    if (data.DKIMHost && data.DKIMTextValue) {
      records.push({
        type: 'TXT',
        host: data.DKIMHost,
        value: data.DKIMTextValue,
      });
    }

    if (data.ReturnPathDomain && data.ReturnPathDomainCNAMEValue) {
      records.push({
        type: 'CNAME',
        host: data.ReturnPathDomain,
        value: data.ReturnPathDomainCNAMEValue,
      });
    }

    return records;
  }

  private parsePostmarkError(error: unknown): {
    message: string;
    status?: number;
  } {
    if (isAxiosError<{ Message?: string }>(error)) {
      return {
        message:
          error.response?.data?.Message ?? error.message ?? 'Unknown error',
        status: error.response?.status,
      };
    }
    if (error instanceof Error) {
      return { message: error.message };
    }
    return { message: String(error) };
  }

  private headers(accountToken: string): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Account-Token': accountToken,
    };
  }
}
