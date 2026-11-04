import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../common/encryption/encryption.service';
import { reencryptLegacySecrets } from './reencrypt-legacy-secrets';

const KEY = 'a'.repeat(64);

const legacy = (text: string): string => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(KEY, 'hex'),
    iv,
  );
  return (
    iv.toString('hex') +
    ':' +
    Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('hex')
  );
};

describe('reencryptLegacySecrets', () => {
  const encryption = new EncryptionService({
    get: () => KEY,
  } as unknown as ConfigService);

  const prisma = {
    customerEmailProvider: { findMany: jest.fn(), updateMany: jest.fn() },
    customer: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  const client = prisma as unknown as PrismaClient;

  const legacyApiKey = legacy('SG.provider-key');
  const legacyAccountKey = legacy('account-token');
  const legacySecret = legacy('whsec_abc');
  const currentKey = encryption.encrypt('re_already_gcm');

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.customerEmailProvider.findMany.mockResolvedValue([
      { id: 'p1', apiKey: legacyApiKey, accountApiKey: legacyAccountKey },
      { id: 'p2', apiKey: currentKey, accountApiKey: null },
    ]);
    prisma.customer.findMany.mockResolvedValue([
      { id: 'c1', webhookSigningSecret: legacySecret },
    ]);
    prisma.customerEmailProvider.updateMany.mockResolvedValue({ count: 1 });
    prisma.customer.updateMany.mockResolvedValue({ count: 1 });
  });

  it('reports legacy values without writing on a dry run', async () => {
    const reports = await reencryptLegacySecrets(client, encryption, {
      apply: false,
    });

    expect(reports.map((r) => [r.column, r.legacy, r.migrated])).toEqual([
      ['customer_email_providers.api_key', 1, 0],
      ['customer_email_providers.account_api_key', 1, 0],
      ['customers.webhook_signing_secret', 1, 0],
    ]);
    expect(prisma.customerEmailProvider.updateMany).not.toHaveBeenCalled();
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });

  it('re-encrypts legacy values to GCM and leaves current ones alone', async () => {
    const reports = await reencryptLegacySecrets(client, encryption, {
      apply: true,
    });

    expect(reports.every((r) => r.migrated === 1 && !r.failed.length)).toBe(
      true,
    );
    expect(prisma.customerEmailProvider.updateMany).toHaveBeenCalledTimes(2);

    const [apiKeyCall, accountKeyCall] =
      prisma.customerEmailProvider.updateMany.mock.calls.map((c) => c[0]);

    expect(apiKeyCall.where).toEqual({ id: 'p1', apiKey: legacyApiKey });
    expect(encryption.isLegacyFormat(apiKeyCall.data.apiKey)).toBe(false);
    expect(encryption.decrypt(apiKeyCall.data.apiKey)).toBe('SG.provider-key');

    expect(accountKeyCall.where).toEqual({
      id: 'p1',
      accountApiKey: legacyAccountKey,
    });
    expect(encryption.decrypt(accountKeyCall.data.accountApiKey)).toBe(
      'account-token',
    );

    const secretCall = prisma.customer.updateMany.mock.calls[0][0];
    expect(secretCall.where).toEqual({
      id: 'c1',
      webhookSigningSecret: legacySecret,
    });
    expect(encryption.decrypt(secretCall.data.webhookSigningSecret)).toBe(
      'whsec_abc',
    );
  });

  it('counts a row as skipped when it changed after being read', async () => {
    prisma.customer.updateMany.mockResolvedValue({ count: 0 });

    const reports = await reencryptLegacySecrets(client, encryption, {
      apply: true,
    });

    expect(reports[2]).toMatchObject({ legacy: 1, migrated: 0, skipped: 1 });
  });

  it('records undecryptable values as failures and keeps going', async () => {
    prisma.customerEmailProvider.findMany.mockResolvedValue([
      { id: 'bad', apiKey: `${'0'.repeat(32)}:zz`, accountApiKey: null },
      { id: 'p1', apiKey: legacyApiKey, accountApiKey: null },
    ]);

    const reports = await reencryptLegacySecrets(client, encryption, {
      apply: true,
    });

    expect(reports[0].failed).toEqual([expect.stringMatching(/^bad: /)]);
    expect(reports[0].migrated).toBe(1);
  });

  it('is a no-op once everything is migrated', async () => {
    prisma.customerEmailProvider.findMany.mockResolvedValue([
      { id: 'p2', apiKey: currentKey, accountApiKey: null },
    ]);
    prisma.customer.findMany.mockResolvedValue([]);

    const reports = await reencryptLegacySecrets(client, encryption, {
      apply: true,
    });

    expect(reports.every((r) => r.legacy === 0)).toBe(true);
    expect(prisma.customerEmailProvider.updateMany).not.toHaveBeenCalled();
  });
});
