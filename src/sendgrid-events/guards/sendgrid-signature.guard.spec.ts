import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ExecutionContext,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { SendgridSignatureGuard } from './sendgrid-signature.guard';

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
  headers: {
    'x-twilio-email-event-webhook-signature': 'sig',
    'x-twilio-email-event-webhook-timestamp': 'ts',
    ...((overrides.headers as object) ?? {}),
  },
  rawBody: Buffer.from('{}'),
  ...overrides,
});

const buildGuard = async (
  config: Record<string, string | undefined>,
): Promise<SendgridSignatureGuard> => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SendgridSignatureGuard,
      {
        provide: ConfigService,
        useValue: { get: jest.fn((key: string) => config[key]) },
      },
    ],
  }).compile();
  return module.get(SendgridSignatureGuard);
};

describe('SendgridSignatureGuard', () => {
  beforeEach(() => {
    verifySignature.mockReset();
    convertPublicKeyToECDSA.mockClear().mockReturnValue('ecdsa-public-key');
  });

  describe('verification key configuration', () => {
    it('skips signature checks (and returns true) when key is unset in dev', async () => {
      const guard = await buildGuard({ NODE_ENV: 'development' });

      expect(guard.canActivate(buildContext(validRequest()))).toBe(true);
      expect(verifySignature).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when key is unset in production', async () => {
      const guard = await buildGuard({ NODE_ENV: 'production' });

      expect(() => guard.canActivate(buildContext(validRequest()))).toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('header validation', () => {
    it('rejects when signature header is missing', async () => {
      const guard = await buildGuard({
        SENDGRID_WEBHOOK_VERIFICATION_KEY: 'pubkey',
      });

      const req = validRequest({
        headers: { 'x-twilio-email-event-webhook-timestamp': 'ts' },
      });

      expect(() => guard.canActivate(buildContext(req))).toThrow(
        'Missing SendGrid webhook headers',
      );
    });

    it('rejects when timestamp header is missing', async () => {
      const guard = await buildGuard({
        SENDGRID_WEBHOOK_VERIFICATION_KEY: 'pubkey',
      });

      const req = validRequest({
        headers: { 'x-twilio-email-event-webhook-signature': 'sig' },
      });

      expect(() => guard.canActivate(buildContext(req))).toThrow(
        'Missing SendGrid webhook headers',
      );
    });

    it('rejects when rawBody is missing', async () => {
      const guard = await buildGuard({
        SENDGRID_WEBHOOK_VERIFICATION_KEY: 'pubkey',
      });

      const req = validRequest({ rawBody: undefined });

      expect(() => guard.canActivate(buildContext(req))).toThrow(
        'Missing SendGrid webhook headers',
      );
    });
  });

  describe('signature verification', () => {
    it('returns true when SendGrid library verifies the signature', async () => {
      verifySignature.mockReturnValue(true);
      const guard = await buildGuard({
        SENDGRID_WEBHOOK_VERIFICATION_KEY: 'pubkey',
      });

      expect(guard.canActivate(buildContext(validRequest()))).toBe(true);
      expect(convertPublicKeyToECDSA).toHaveBeenCalledWith('pubkey');
      expect(verifySignature).toHaveBeenCalledWith(
        'ecdsa-public-key',
        expect.any(Buffer),
        'sig',
        'ts',
      );
    });

    it('throws UnauthorizedException when the library returns false', async () => {
      verifySignature.mockReturnValue(false);
      const guard = await buildGuard({
        SENDGRID_WEBHOOK_VERIFICATION_KEY: 'pubkey',
      });

      expect(() => guard.canActivate(buildContext(validRequest()))).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the library throws', async () => {
      verifySignature.mockImplementation(() => {
        throw new Error('library blew up');
      });
      const guard = await buildGuard({
        SENDGRID_WEBHOOK_VERIFICATION_KEY: 'pubkey',
      });

      expect(() => guard.canActivate(buildContext(validRequest()))).toThrow(
        'Invalid SendGrid webhook signature',
      );
    });
  });
});
