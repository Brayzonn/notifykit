import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { BrevoService } from './brevo.service';
import { ProviderError } from '../provider-error';

const API_KEY = 'xkeysib-test';

const baseParams = {
  to: 'user@example.com',
  subject: 'Hello',
  body: '<p>Hi</p>',
};

describe('BrevoService', () => {
  let service: BrevoService;
  let httpService: { post: jest.Mock };

  beforeEach(async () => {
    httpService = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrevoService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) =>
              key === 'BREVO_FROM_EMAIL' ? 'platform@notifykit.dev' : fallback,
            ),
          },
        },
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get(BrevoService);
    httpService.post.mockReturnValue(
      of({ status: 201, data: { messageId: '<msg-1@relay>' } }),
    );
  });

  it('posts to the Brevo SMTP endpoint with the api-key header', async () => {
    await service.sendEmail(baseParams, API_KEY);

    expect(httpService.post).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { email: 'platform@notifykit.dev' },
        to: [{ email: 'user@example.com' }],
        subject: 'Hello',
        htmlContent: '<p>Hi</p>',
      },
      {
        headers: expect.objectContaining({ 'api-key': API_KEY }),
      },
    );
  });

  it('uses the provided from address', async () => {
    await service.sendEmail(
      { ...baseParams, from: 'support@em.acme.com' },
      API_KEY,
    );

    const [, payload] = httpService.post.mock.calls[0];
    expect(payload.sender).toEqual({ email: 'support@em.acme.com' });
  });

  it('tags the message with the job id', async () => {
    await service.sendEmail({ ...baseParams, jobId: 'job-123' }, API_KEY);

    const [, payload] = httpService.post.mock.calls[0];
    expect(payload.tags).toEqual(['job_id:job-123']);
    expect(payload.headers).toBeUndefined();
  });

  it('returns the Brevo message id', async () => {
    const result = await service.sendEmail(baseParams, API_KEY);

    expect(result).toEqual({
      statusCode: 201,
      message: 'Email accepted for delivery',
      to: 'user@example.com',
      subject: 'Hello',
      messageId: '<msg-1@relay>',
    });
  });

  it('throws when no API key is given', async () => {
    await expect(service.sendEmail(baseParams, '')).rejects.toThrow(
      'No Brevo API key available',
    );
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('wraps HTTP errors in a ProviderError that keeps the status', async () => {
    httpService.post.mockReturnValue(
      throwError(() => ({
        isAxiosError: true,
        message: 'Request failed with status code 401',
        response: {
          status: 401,
          data: { code: 'unauthorized', message: 'Key not found' },
        },
        request: {},
      })),
    );

    const error = await service
      .sendEmail(baseParams, API_KEY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toBe(
      'Brevo API error: Key not found',
    );
    expect((error as ProviderError).response?.status).toBe(401);
  });
});
