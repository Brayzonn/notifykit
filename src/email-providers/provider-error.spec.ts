import { ProviderError } from './provider-error';
import {
  getAxiosErrorData,
  getAxiosErrorStatus,
  isTransientError,
} from '@/common/utils/error.util';

const axiosLike = (overrides: Record<string, unknown>) =>
  Object.assign(new Error('Request failed'), { request: {}, ...overrides });

describe('ProviderError', () => {
  describe('fromHttpError', () => {
    it.each([429, 500, 502, 503, 504])(
      'keeps status %s and is transient',
      (status) => {
        const error = ProviderError.fromHttpError(
          'SendGrid API error',
          axiosLike({ response: { status, data: { errors: [] } } }),
        );

        expect(error.message).toBe('SendGrid API error');
        expect(getAxiosErrorStatus(error)).toBe(status);
        expect(isTransientError(error)).toBe(true);
      },
    );

    it.each([400, 401, 403, 413])(
      'keeps status %s and is not transient',
      (status) => {
        const error = ProviderError.fromHttpError(
          'SendGrid API error',
          axiosLike({ response: { status, data: {} } }),
        );

        expect(isTransientError(error)).toBe(false);
      },
    );

    it('keeps the provider response body', () => {
      const data = { errors: [{ message: 'The from address does not match' }] };
      const error = ProviderError.fromHttpError(
        'SendGrid API error',
        axiosLike({ response: { status: 403, data } }),
      );

      expect(getAxiosErrorData(error)).toEqual(data);
    });

    it('treats a request with no response as transient', () => {
      const error = ProviderError.fromHttpError(
        'SendGrid API error',
        axiosLike({}),
      );

      expect(getAxiosErrorStatus(error)).toBeUndefined();
      expect(isTransientError(error)).toBe(true);
    });

    it.each(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'])(
      'keeps error code %s and is transient',
      (code) => {
        const error = ProviderError.fromHttpError(
          'SendGrid API error',
          axiosLike({ code }),
        );

        expect(error.code).toBe(code);
        expect(isTransientError(error)).toBe(true);
      },
    );

    it('is not transient for an error that never reached the network', () => {
      const error = ProviderError.fromHttpError(
        'SendGrid API error',
        new Error('boom'),
      );

      expect(isTransientError(error)).toBe(false);
    });
  });

  it('marks a no-response error as a request without response', () => {
    const error = new ProviderError('Resend API error', { noResponse: true });

    expect(isTransientError(error)).toBe(true);
  });

  it('ignores noResponse when a status is present', () => {
    const error = new ProviderError('Resend API error', {
      status: 400,
      noResponse: true,
    });

    expect(isTransientError(error)).toBe(false);
  });
});
