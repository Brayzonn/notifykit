import { redactUrl } from './url.util';

describe('redactUrl', () => {
  it.each([
    [
      '/api/v1/user/email/verify-new/abc123',
      '/api/v1/user/email/verify-new/[redacted]',
    ],
    [
      '/api/v1/user/email/confirm-old/abc123',
      '/api/v1/user/email/confirm-old/[redacted]',
    ],
    [
      '/api/v1/user/email/cancel/abc123?x=1',
      '/api/v1/user/email/cancel/[redacted]?x=1',
    ],
  ])('redacts token in %s', (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });

  it('leaves other URLs unchanged', () => {
    expect(redactUrl('/api/v1/jobs/123')).toBe('/api/v1/jobs/123');
  });
});
