import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { BrevoSignatureGuard } from './brevo-signature.guard';
import { PrismaService } from '@/prisma/prisma.service';

const buildContext = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as ExecutionContext;

const basicAuth = (user: string, pass: string) =>
  'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

describe('BrevoSignatureGuard', () => {
  let guard: BrevoSignatureGuard;
  const prisma = {
    customer: { findUnique: jest.fn() },
    customerEmailProvider: { findUnique: jest.fn() },
  };

  const withSecret = () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'brevo-secret',
    });
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrevoSignatureGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(BrevoSignatureGuard);
    prisma.customer.findUnique.mockReset();
    prisma.customerEmailProvider.findUnique.mockReset();
  });

  it('rejects unknown customers', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce(null);

    await expect(
      guard.canActivate(
        buildContext({ params: { customerId: 'c-1' }, headers: {} }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns 404 when no Brevo webhook secret is saved', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: null,
    });

    await expect(
      guard.canActivate(
        buildContext({ params: { customerId: 'c-1' }, headers: {} }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects requests without credentials', async () => {
    withSecret();

    await expect(
      guard.canActivate(
        buildContext({ params: { customerId: 'c-1' }, headers: {} }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a matching bearer token', async () => {
    withSecret();

    await expect(
      guard.canActivate(
        buildContext({
          params: { customerId: 'c-1' },
          headers: { authorization: 'Bearer brevo-secret' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('accepts a matching basic auth password', async () => {
    withSecret();

    await expect(
      guard.canActivate(
        buildContext({
          params: { customerId: 'c-1' },
          headers: { authorization: basicAuth('brevo', 'brevo-secret') },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects a wrong token', async () => {
    withSecret();

    await expect(
      guard.canActivate(
        buildContext({
          params: { customerId: 'c-1' },
          headers: { authorization: 'Bearer nope' },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects unsupported auth schemes', async () => {
    withSecret();

    await expect(
      guard.canActivate(
        buildContext({
          params: { customerId: 'c-1' },
          headers: { authorization: 'Token brevo-secret' },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
