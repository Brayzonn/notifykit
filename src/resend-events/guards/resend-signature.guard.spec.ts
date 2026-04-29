import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ResendSignatureGuard } from './resend-signature.guard';
import { PrismaService } from '@/prisma/prisma.service';
import { Webhook } from 'svix';

const verify = jest.fn();

jest.mock('svix', () => ({
  Webhook: jest.fn().mockImplementation(() => ({ verify })),
}));

const WebhookCtor = Webhook as unknown as jest.Mock;

const buildContext = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as ExecutionContext;

const validRequest = (overrides: Record<string, unknown> = {}) => ({
  params: { customerId: 'c-1', ...((overrides.params as object) ?? {}) },
  headers: {
    'svix-id': 'msg-1',
    'svix-timestamp': '1700000000',
    'svix-signature': 'v1,sig',
    ...((overrides.headers as object) ?? {}),
  },
  rawBody: Buffer.from('{}'),
  ...overrides,
});

describe('ResendSignatureGuard', () => {
  let guard: ResendSignatureGuard;
  const prisma = {
    customer: { findUnique: jest.fn() },
    customerEmailProvider: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResendSignatureGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(ResendSignatureGuard);
    prisma.customer.findUnique.mockReset();
    prisma.customerEmailProvider.findUnique.mockReset();
    verify.mockReset();
    WebhookCtor.mockClear().mockImplementation(() => ({ verify }));
  });

  it('rejects requests for unknown customers', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce(null);

    await expect(
      guard.canActivate(buildContext(validRequest())),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws NotFoundException when no Resend provider record exists', async () => {
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

  it.each([
    ['svix-id', { 'svix-id': '' }],
    ['svix-timestamp', { 'svix-timestamp': '' }],
    ['svix-signature', { 'svix-signature': '' }],
  ])('rejects when %s header is missing', async (_, override) => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'whsec_x',
    });

    const req = validRequest({
      headers: { ...validRequest().headers, ...override },
    });

    await expect(guard.canActivate(buildContext(req))).rejects.toThrow(
      'Missing Resend webhook headers',
    );
  });

  it('rejects when rawBody is missing', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'whsec_x',
    });

    await expect(
      guard.canActivate(buildContext(validRequest({ rawBody: undefined }))),
    ).rejects.toThrow('Missing Resend webhook headers');
  });

  it('rejects when svix.verify throws', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'whsec_x',
    });
    verify.mockImplementation(() => {
      throw new Error('bad signature');
    });

    await expect(guard.canActivate(buildContext(validRequest()))).rejects.toThrow(
      'Invalid Resend webhook signature',
    );
  });

  it('returns true when svix.verify succeeds', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'whsec_x',
    });
    verify.mockReturnValue(undefined);

    await expect(
      guard.canActivate(buildContext(validRequest())),
    ).resolves.toBe(true);

    expect(WebhookCtor).toHaveBeenCalledWith('whsec_x');
    expect(verify).toHaveBeenCalledWith(expect.any(Buffer), {
      'svix-id': 'msg-1',
      'svix-timestamp': '1700000000',
      'svix-signature': 'v1,sig',
    });
  });
});
