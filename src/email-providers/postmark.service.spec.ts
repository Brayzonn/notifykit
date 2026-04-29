import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { PostmarkService } from './postmark.service';

const API_KEY = 'pm-server-token';
const DEFAULT_FROM = 'noreply@notifykit.dev';

const createConfigService = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string, defaultValue?: string) => {
    const config: Record<string, string> = {
      POSTMARK_FROM_EMAIL: DEFAULT_FROM,
      POSTMARK_MESSAGE_STREAM: 'outbound',
      ...overrides,
    };
    return config[key] ?? defaultValue;
  }),
});

const baseParams = {
  to: 'user@example.com',
  subject: 'Hello',
  body: '<p>Hi</p>',
};

describe('PostmarkService', () => {
  let service: PostmarkService;
  let httpService: { post: jest.Mock };

  beforeEach(async () => {
    httpService = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostmarkService,
        { provide: ConfigService, useValue: createConfigService() },
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get<PostmarkService>(PostmarkService);
    httpService.post.mockReturnValue(
      of({ status: 200, data: { Message: 'OK', MessageID: 'msg-1' } }),
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('Request construction', () => {
    it('should POST to the Postmark email endpoint', async () => {
      await service.sendEmail(baseParams, API_KEY);

      expect(httpService.post).toHaveBeenCalledWith(
        'https://api.postmarkapp.com/email',
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should send the API key in the X-Postmark-Server-Token header', async () => {
      await service.sendEmail(baseParams, API_KEY);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Postmark-Server-Token': API_KEY,
          }),
        }),
      );
    });

    it('should build the correct Postmark payload with custom from', async () => {
      await service.sendEmail(
        { ...baseParams, from: 'custom@example.com' },
        API_KEY,
      );

      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        {
          From: 'custom@example.com',
          To: 'user@example.com',
          Subject: 'Hello',
          HtmlBody: '<p>Hi</p>',
          MessageStream: 'outbound',
        },
        expect.any(Object),
      );
    });

    it('should fall back to the default from address when none is provided', async () => {
      await service.sendEmail(baseParams, API_KEY);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ From: DEFAULT_FROM }),
        expect.any(Object),
      );
    });

    it('should attach Metadata.job_id when jobId is provided', async () => {
      await service.sendEmail({ ...baseParams, jobId: 'job-abc' }, API_KEY);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ Metadata: { job_id: 'job-abc' } }),
        expect.any(Object),
      );
    });

    it('should omit Metadata when no jobId is provided', async () => {
      await service.sendEmail(baseParams, API_KEY);

      const payload = httpService.post.mock.calls[0][1];
      expect(payload).not.toHaveProperty('Metadata');
    });
  });

  describe('Response handling', () => {
    it('should return statusCode, messageId and to/subject on success', async () => {
      const result = await service.sendEmail(baseParams, API_KEY);

      expect(result).toEqual({
        statusCode: 200,
        message: 'OK',
        to: 'user@example.com',
        subject: 'Hello',
        messageId: 'msg-1',
      });
    });

    it('should fall back to a generic message when Postmark omits Message', async () => {
      httpService.post.mockReturnValueOnce(of({ status: 200, data: {} }));

      const result = await service.sendEmail(baseParams, API_KEY);
      expect(result.message).toBe('Email accepted for delivery');
    });

    it('should throw when no API key is provided', async () => {
      await expect(service.sendEmail(baseParams, '')).rejects.toThrow(
        'No Postmark server token available',
      );
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should rethrow when Postmark rejects', async () => {
      httpService.post.mockReturnValueOnce(
        throwError(() => new Error('Postmark down')),
      );

      await expect(service.sendEmail(baseParams, API_KEY)).rejects.toThrow(
        'Postmark down',
      );
    });
  });
});
