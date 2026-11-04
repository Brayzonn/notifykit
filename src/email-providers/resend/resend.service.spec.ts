import { ConfigService } from '@nestjs/config';
import { ResendService } from './resend.service';
import { ProviderError } from '../provider-error';
import {
  getAxiosErrorData,
  getAxiosErrorStatus,
  isTransientError,
} from '@/common/utils/error.util';

const send = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
}));

const baseParams = {
  to: 'user@example.com',
  subject: 'Hello',
  body: '<p>Hi</p>',
  jobId: 'job-1',
};

describe('ResendService', () => {
  const service = new ResendService({
    get: (key: string, fallback?: string) =>
      key === 'RESEND_FROM_EMAIL' ? 'noreply@notifykit.dev' : fallback,
  } as unknown as ConfigService);

  beforeEach(() => send.mockReset());

  it('returns the message id on success', async () => {
    send.mockResolvedValue({ data: { id: 're_1' }, error: null });

    await expect(
      service.sendEmail(baseParams, 're_key'),
    ).resolves.toMatchObject({ statusCode: 200, messageId: 're_1' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [{ name: 'job_id', value: 'job-1' }],
      }),
    );
  });

  it.each([429, 500, 503])(
    'keeps status %s from the Resend error and is transient',
    async (statusCode) => {
      const resendError = {
        statusCode,
        name: 'rate_limit_exceeded',
        message: 'Too many requests',
      };
      send.mockResolvedValue({ data: null, error: resendError });

      const error = await service
        .sendEmail(baseParams, 're_key')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ProviderError);
      expect((error as Error).message).toBe(
        `Resend API error: ${JSON.stringify(resendError)}`,
      );
      expect(getAxiosErrorStatus(error)).toBe(statusCode);
      expect(getAxiosErrorData(error)).toEqual(resendError);
      expect(isTransientError(error)).toBe(true);
    },
  );

  it('is not transient for a 4xx validation error', async () => {
    send.mockResolvedValue({
      data: null,
      error: {
        statusCode: 422,
        name: 'invalid_from_address',
        message: 'Invalid from',
      },
    });

    const error = await service
      .sendEmail(baseParams, 're_key')
      .catch((e: unknown) => e);

    expect(getAxiosErrorStatus(error)).toBe(422);
    expect(isTransientError(error)).toBe(false);
  });

  it('treats an unreachable Resend API as transient', async () => {
    send.mockResolvedValue({
      data: null,
      error: {
        statusCode: null,
        name: 'application_error',
        message: 'Unable to fetch data. The request could not be resolved.',
      },
    });

    const error = await service
      .sendEmail(baseParams, 're_key')
      .catch((e: unknown) => e);

    expect(getAxiosErrorStatus(error)).toBeUndefined();
    expect(isTransientError(error)).toBe(true);
  });

  it('is not transient for a local SDK validation error', async () => {
    send.mockResolvedValue({
      data: null,
      error: {
        statusCode: null,
        name: 'missing_required_field',
        message: 'Missing `to` field.',
      },
    });

    const error = await service
      .sendEmail(baseParams, 're_key')
      .catch((e: unknown) => e);

    expect(isTransientError(error)).toBe(false);
  });
});
