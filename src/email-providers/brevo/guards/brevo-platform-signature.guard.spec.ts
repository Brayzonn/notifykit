import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoPlatformSignatureGuard } from './brevo-platform-signature.guard';

const buildContext = (headers: Record<string, string>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as ExecutionContext;

const buildGuard = (secret?: string) =>
  new BrevoPlatformSignatureGuard({
    get: jest.fn(() => secret),
  } as unknown as ConfigService);

describe('BrevoPlatformSignatureGuard', () => {
  it('returns 404 when BREVO_WEBHOOK_SECRET is not set', () => {
    expect(() =>
      buildGuard().canActivate(buildContext({ authorization: 'Bearer x' })),
    ).toThrow(NotFoundException);
  });

  it('accepts a matching bearer token', () => {
    expect(
      buildGuard('platform-secret').canActivate(
        buildContext({ authorization: 'Bearer platform-secret' }),
      ),
    ).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(() =>
      buildGuard('platform-secret').canActivate(
        buildContext({ authorization: 'Bearer wrong' }),
      ),
    ).toThrow(UnauthorizedException);
  });
});
