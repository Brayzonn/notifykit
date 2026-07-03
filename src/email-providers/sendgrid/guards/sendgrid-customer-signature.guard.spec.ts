import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SendgridCustomerSignatureGuard } from './sendgrid-customer-signature.guard';
import { PrismaService } from '@/prisma/prisma.service';

const verifySignature = jest.fn();
const convertPublicKeyToECDSA = jest.fn().mockReturnValue('ecdsa-public-key');

jest.mock('@sendgrid/eventwebhook', () => ({
  EventWebhook: jest.fn().mockImplementation(() => ({
    convertPublicKeyToECDSA,
    verifySignature,
  })),
}));

const buildContext = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as ExecutionContext;

const validRequest = (overrides: Record<string, unknown> = {}) => ({
  params: { customerId: 'c-1', ...((overrides.params as object) ?? {}) },
  headers: {
    'x-twilio-email-event-webhook-signature': 'sig',
    'x-twilio-email-event-webhook-timestamp': 'ts',
    ...((overrides.headers as object) ?? {}),
  },
  rawBody: Buffer.from('{}'),
  ...overrides,
});

describe('SendgridCustomerSignatureGuard', () => {
  let guard: SendgridCustomerSignatureGuard;
  const prisma = {
    customer: { findUnique: jest.fn() },
    customerEmailProvider: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendgridCustomerSignatureGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(SendgridCustomerSignatureGuard);
    prisma.customer.findUnique.mockReset();
    prisma.customerEmailProvider.findUnique.mockReset();
    verifySignature.mockReset();
    convertPublicKeyToECDSA.mockClear().mockReturnValue('ecdsa-public-key');
  });

  it('rejects requests for unknown customers', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce(null);

    await expect(
      guard.canActivate(buildContext(validRequest())),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws NotFoundException when no SendGrid provider record exists', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce(null);

    await expect(
      guard.canActivate(buildContext(validRequest())),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when webhookSecret is null', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: null,
    });

    await expect(
      guard.canActivate(buildContext(validRequest())),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when signature header is missing', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'pubkey',
    });
    const req = validRequest({
      headers: { 'x-twilio-email-event-webhook-timestamp': 'ts' },
    });

    await expect(guard.canActivate(buildContext(req))).rejects.toThrow(
      'Missing SendGrid webhook headers',
    );
  });

  it('rejects when rawBody is missing', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'pubkey',
    });

    await expect(
      guard.canActivate(buildContext(validRequest({ rawBody: undefined }))),
    ).rejects.toThrow('Missing SendGrid webhook headers');
  });

  it('rejects when the library returns false', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'pubkey',
    });
    verifySignature.mockReturnValue(false);

    await expect(
      guard.canActivate(buildContext(validRequest())),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the library throws', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'pubkey',
    });
    verifySignature.mockImplementation(() => {
      throw new Error('blew up');
    });

    await expect(
      guard.canActivate(buildContext(validRequest())),
    ).rejects.toThrow('Invalid SendGrid webhook signature');
  });

  it('returns true when the library verifies the signature', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'pubkey',
    });
    verifySignature.mockReturnValue(true);

    await expect(guard.canActivate(buildContext(validRequest()))).resolves.toBe(
      true,
    );
    expect(convertPublicKeyToECDSA).toHaveBeenCalledWith('pubkey');
  });
});
