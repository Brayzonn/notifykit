import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PostmarkSignatureGuard } from './postmark-signature.guard';
import { PrismaService } from '@/prisma/prisma.service';

const buildContext = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as ExecutionContext;

const basicAuth = (user: string, pass: string) =>
  'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

describe('PostmarkSignatureGuard', () => {
  let guard: PostmarkSignatureGuard;
  const prisma = {
    customer: { findUnique: jest.fn() },
    customerEmailProvider: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostmarkSignatureGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(PostmarkSignatureGuard);
    prisma.customer.findUnique.mockReset();
    prisma.customerEmailProvider.findUnique.mockReset();
  });

  it('rejects requests for unknown customers', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce(null);
    const context = buildContext({
      params: { customerId: 'c-1' },
      headers: {},
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws NotFoundException when no Postmark provider record exists', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce(null);
    const context = buildContext({
      params: { customerId: 'c-1' },
      headers: {},
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when webhookSecret is null', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: null,
    });
    const context = buildContext({
      params: { customerId: 'c-1' },
      headers: { authorization: basicAuth('postmark', 'whatever') },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects when Authorization header is missing', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'expected',
    });
    const context = buildContext({
      params: { customerId: 'c-1' },
      headers: {},
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Missing Postmark webhook credentials',
    );
  });

  it('rejects non-Basic Authorization schemes', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'expected',
    });
    const context = buildContext({
      params: { customerId: 'c-1' },
      headers: { authorization: 'Bearer something' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Missing Postmark webhook credentials',
    );
  });

  it('rejects when password mismatches the stored secret', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'expected-secret',
    });
    const context = buildContext({
      params: { customerId: 'c-1' },
      headers: { authorization: basicAuth('postmark', 'wrong') },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Postmark webhook credentials',
    );
  });

  it('rejects when password is the same prefix but different length', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'expected-secret',
    });
    const context = buildContext({
      params: { customerId: 'c-1' },
      headers: { authorization: basicAuth('postmark', 'expected') },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Postmark webhook credentials',
    );
  });

  it('returns true when Basic Auth password matches webhookSecret', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({ id: 'c-1' });
    prisma.customerEmailProvider.findUnique.mockResolvedValueOnce({
      webhookSecret: 'expected-secret',
    });
    const context = buildContext({
      params: { customerId: 'c-1' },
      headers: { authorization: basicAuth('postmark', 'expected-secret') },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
