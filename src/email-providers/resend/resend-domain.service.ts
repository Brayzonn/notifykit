import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class ResendDomainService {
  private readonly logger = new Logger(ResendDomainService.name);

  private getClient(apiKey: string): Resend {
    return new Resend(apiKey);
  }

  /**
   * Register a domain with Resend and return its DNS records.
   * If the domain already exists in the account, fetches the existing record.
   */
  async authenticateDomain(
    domain: string,
    apiKey: string,
  ): Promise<{
    domainId: string;
    dnsRecords: Array<{ type: string; host: string; value: string }>;
    valid: boolean;
  }> {
    const resend = this.getClient(apiKey);

    const { data, error } = await resend.domains.create({ name: domain });

    if (error) {
      if (
        error.name === 'validation_error' &&
        error.message.toLowerCase().includes('already exist')
      ) {
        this.logger.warn(
          `Domain ${domain} already exists in Resend — fetching existing record`,
        );
        return this.findExistingDomain(domain, apiKey);
      }

      this.logger.error(`Resend domain creation failed: ${error.message}`);
      throw new BadGatewayException(
        `Failed to authenticate domain with Resend: ${error.message}`,
      );
    }

    this.logger.log(`Domain authentication initiated for: ${domain}`);

    return {
      domainId: data.id,
      dnsRecords: this.extractDnsRecords(data.records),
      valid: data.status === 'verified',
    };
  }

  /**
   * Trigger a verification check on the domain, then return the result.
   */
  async validateDomain(
    domainId: string,
    apiKey: string,
  ): Promise<{ valid: boolean; validationResults: any }> {
    const resend = this.getClient(apiKey);

    const { error: verifyError } = await resend.domains.verify(domainId);

    if (verifyError) {
      this.logger.error(`Resend domain verify call failed: ${verifyError.message}`);
      throw new BadGatewayException(
        `Failed to verify domain with Resend: ${verifyError.message}`,
      );
    }

    const { data, error: getError } = await resend.domains.get(domainId);

    if (getError) {
      this.logger.error(`Resend domain get failed: ${getError.message}`);
      throw new BadGatewayException(
        `Failed to retrieve domain status from Resend: ${getError.message}`,
      );
    }

    const valid = data.status === 'verified';
    const validationResults = data.records
      ? data.records.map((r) => ({ record: r.record, name: r.name, status: r.status }))
      : null;

    return { valid, validationResults };
  }

  /**
   * Remove a domain from Resend.
   */
  async deleteDomain(domainId: string, apiKey: string): Promise<void> {
    const resend = this.getClient(apiKey);

    const { error } = await resend.domains.remove(domainId);

    if (error) {
      this.logger.error(`Failed to delete Resend domain ${domainId}: ${error.message}`);
      throw new Error(error.message);
    }

    this.logger.log(`Resend domain deleted: ${domainId}`);
  }

  private async findExistingDomain(
    domain: string,
    apiKey: string,
  ): Promise<{
    domainId: string;
    dnsRecords: Array<{ type: string; host: string; value: string }>;
    valid: boolean;
  }> {
    const resend = this.getClient(apiKey);
    const { data, error } = await resend.domains.list();

    if (error) {
      throw new BadGatewayException(
        `Failed to list Resend domains: ${error.message}`,
      );
    }

    const existing = data?.data?.find((d) => d.name === domain);

    if (!existing) {
      throw new BadGatewayException(
        `Domain ${domain} exists in Resend but could not be retrieved`,
      );
    }

    const { data: full, error: getError } = await resend.domains.get(existing.id);

    if (getError) {
      throw new BadGatewayException(
        `Failed to retrieve existing Resend domain: ${getError.message}`,
      );
    }

    this.logger.log(`Retrieved existing Resend domain record for: ${domain}`);

    return {
      domainId: full.id,
      dnsRecords: this.extractDnsRecords(full.records),
      valid: full.status === 'verified',
    };
  }

  private extractDnsRecords(
    records: any[],
  ): Array<{ type: string; host: string; value: string }> {
    return (records ?? [])
      .filter((r) => r.record !== 'Receiving')
      .map((r) => ({
        type: r.type,
        host: r.name,
        value: r.value,
      }));
  }
}
