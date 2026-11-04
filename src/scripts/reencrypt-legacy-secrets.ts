import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../common/encryption/encryption.service';

export interface ColumnReport {
  column: string;
  legacy: number;
  migrated: number;
  skipped: number;
  failed: string[];
}

type Encryption = Pick<
  EncryptionService,
  'encrypt' | 'decrypt' | 'isLegacyFormat'
>;

const reencrypt = (encryption: Encryption, value: string): string => {
  const plaintext = encryption.decrypt(value);
  const upgraded = encryption.encrypt(plaintext);

  if (
    encryption.isLegacyFormat(upgraded) ||
    encryption.decrypt(upgraded) !== plaintext
  ) {
    throw new Error('Round-trip verification failed');
  }

  return upgraded;
};

const newReport = (column: string): ColumnReport => ({
  column,
  legacy: 0,
  migrated: 0,
  skipped: 0,
  failed: [],
});

export const reencryptLegacySecrets = async (
  prisma: PrismaClient,
  encryption: Encryption,
  { apply }: { apply: boolean },
): Promise<ColumnReport[]> => {
  const apiKey = newReport('customer_email_providers.api_key');
  const accountApiKey = newReport('customer_email_providers.account_api_key');
  const signingSecret = newReport('customers.webhook_signing_secret');

  const providers = await prisma.customerEmailProvider.findMany({
    select: { id: true, apiKey: true, accountApiKey: true },
  });

  for (const row of providers) {
    for (const [field, report] of [
      ['apiKey', apiKey],
      ['accountApiKey', accountApiKey],
    ] as const) {
      const value = row[field];
      if (!value || !encryption.isLegacyFormat(value)) continue;
      report.legacy++;

      try {
        const upgraded = reencrypt(encryption, value);
        if (!apply) continue;

        const { count } = await prisma.customerEmailProvider.updateMany({
          where: { id: row.id, [field]: value },
          data: { [field]: upgraded },
        });
        if (count === 1) report.migrated++;
        else report.skipped++;
      } catch (error) {
        report.failed.push(
          `${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const customers = await prisma.customer.findMany({
    where: { webhookSigningSecret: { not: null } },
    select: { id: true, webhookSigningSecret: true },
  });

  for (const row of customers) {
    const value = row.webhookSigningSecret;
    if (!value || !encryption.isLegacyFormat(value)) continue;
    signingSecret.legacy++;

    try {
      const upgraded = reencrypt(encryption, value);
      if (!apply) continue;

      const { count } = await prisma.customer.updateMany({
        where: { id: row.id, webhookSigningSecret: value },
        data: { webhookSigningSecret: upgraded },
      });
      if (count === 1) signingSecret.migrated++;
      else signingSecret.skipped++;
    } catch (error) {
      signingSecret.failed.push(
        `${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return [apiKey, accountApiKey, signingSecret];
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  const encryption = new EncryptionService({
    get: (key: string) => process.env[key],
  } as unknown as ConfigService);

  try {
    const reports = await reencryptLegacySecrets(prisma, encryption, {
      apply,
    });

    console.log(apply ? 'APPLY' : 'DRY RUN (pass --apply to write)');
    console.table(
      reports.map(({ column, legacy, migrated, skipped, failed }) => ({
        column,
        legacy,
        migrated,
        skipped,
        failed: failed.length,
      })),
    );

    const failures = reports.flatMap((r) =>
      r.failed.map((f) => `${r.column} ${f}`),
    );
    if (failures.length) {
      console.error('Failures:\n' + failures.join('\n'));
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
