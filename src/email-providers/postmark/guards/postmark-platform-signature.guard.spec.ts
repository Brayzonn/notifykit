import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostmarkPlatformSignatureGuard } from './postmark-platform-signature.guard';

const SECRET = 'platform-postmark-secret';

const buildGuard = (secret?: string) =>
  new PostmarkPlatformSignatureGuard({
    get: (key: string) =>
      key === 'POSTMARK_WEBHOOK_SECRET' ? secret : undefined,
  } as unknown as ConfigService);

const buildContext = (authorization?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authorization ? { authorization } : {},
      }),
    }),
  }) as ExecutionContext;

const basicAuth = (user: string, pass: string) =>
  'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

describe('PostmarkPlatformSignatureGuard', () => {
  it('returns 404 when POSTMARK_WEBHOOK_SECRET is not configured', () => {
    expect(() =>
      buildGuard(undefined).canActivate(buildContext(basicAuth('any', SECRET))),
    ).toThrow(NotFoundException);
  });

  it('accepts the platform secret as the Basic Auth password with any username', () => {
    expect(
      buildGuard(SECRET).canActivate(
        buildContext(basicAuth('anything', SECRET)),
      ),
    ).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(() =>
      buildGuard(SECRET).canActivate(buildContext(basicAuth('any', 'wrong'))),
    ).toThrow('Invalid Postmark webhook credentials');
  });

  it('rejects requests without Basic Auth', () => {
    expect(() => buildGuard(SECRET).canActivate(buildContext())).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      buildGuard(SECRET).canActivate(buildContext('Bearer token')),
    ).toThrow('Missing Postmark webhook credentials');
  });
});
