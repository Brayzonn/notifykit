import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';
import { ResendPlatformSignatureGuard } from './resend-platform-signature.guard';

const SECRET =
  'whsec_' + Buffer.from('platform-resend-secret').toString('base64');

const buildGuard = (secret?: string) =>
  new ResendPlatformSignatureGuard({
    get: (key: string) =>
      key === 'RESEND_WEBHOOK_SECRET' ? secret : undefined,
  } as unknown as ConfigService);

const buildContext = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as ExecutionContext;

const signedRequest = (secret: string, body = '{"type":"email.bounced"}') => {
  const id = 'msg_1';
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(id, timestamp, body);
  return {
    rawBody: Buffer.from(body),
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'svix-signature': signature,
    },
  };
};

describe('ResendPlatformSignatureGuard', () => {
  it('returns 404 when RESEND_WEBHOOK_SECRET is not configured', () => {
    expect(() =>
      buildGuard(undefined).canActivate(buildContext(signedRequest(SECRET))),
    ).toThrow(NotFoundException);
  });

  it('accepts a request signed with the platform secret', () => {
    expect(
      buildGuard(SECRET).canActivate(buildContext(signedRequest(SECRET))),
    ).toBe(true);
  });

  it('rejects a request signed with a different secret', () => {
    const other = 'whsec_' + Buffer.from('someone-else').toString('base64');
    expect(() =>
      buildGuard(SECRET).canActivate(buildContext(signedRequest(other))),
    ).toThrow('Invalid Resend webhook signature');
  });

  it('rejects a tampered body', () => {
    const request = signedRequest(SECRET);
    request.rawBody = Buffer.from('{"type":"email.delivered"}');
    expect(() => buildGuard(SECRET).canActivate(buildContext(request))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects requests missing svix headers', () => {
    expect(() =>
      buildGuard(SECRET).canActivate(
        buildContext({ rawBody: Buffer.from('{}'), headers: {} }),
      ),
    ).toThrow('Missing Resend webhook headers');
  });
});
