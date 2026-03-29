import { Test, TestingModule } from '@nestjs/testing';
import { SendGridService } from './sendgrid.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const API_KEY = 'SG.test_key';
const DEFAULT_FROM = 'noreply@notifykit.dev';

const createConfigService = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string, defaultValue?: string) => {
    const config: Record<string, string> = {
      SENDGRID_FROM_EMAIL: DEFAULT_FROM,
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

describe('SendGridService', () => {
  let service: SendGridService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendGridService,
        { provide: ConfigService, useValue: createConfigService() },
      ],
    }).compile();

    service = module.get<SendGridService>(SendGridService);
    mockedAxios.post.mockResolvedValue({ status: 202, data: '' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Request construction ─────────────────────────────────────────────────────

  describe('Request construction', () => {
    it('should POST to the SendGrid mail/send endpoint', async () => {
      await service.sendEmail(baseParams, API_KEY);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.sendgrid.com/v3/mail/send',
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should use the provided API key in the Authorization header', async () => {
      await service.sendEmail(baseParams, API_KEY);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${API_KEY}` }),
        }),
      );
    });

    it('should build the correct SendGrid payload', async () => {
      await service.sendEmail({ ...baseParams, from: 'custom@example.com' }, API_KEY);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        {
          personalizations: [{ to: [{ email: 'user@example.com' }] }],
          from: { email: 'custom@example.com' },
          subject: 'Hello',
          content: [{ type: 'text/html', value: '<p>Hi</p>' }],
        },
        expect.any(Object),
      );
    });

    it('should fall back to the default from address when none is provided', async () => {
      await service.sendEmail(baseParams, API_KEY);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ from: { email: DEFAULT_FROM } }),
        expect.any(Object),
      );
    });

    it('should include job_id in custom_args when jobId is provided', async () => {
      await service.sendEmail({ ...baseParams, jobId: 'job-abc' }, API_KEY);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ custom_args: { job_id: 'job-abc' } }),
        expect.any(Object),
      );
    });

    it('should send with Content-Type: application/json', async () => {
      await service.sendEmail(baseParams, API_KEY);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
    });
  });

  // ── Response handling ────────────────────────────────────────────────────────

  describe('Response handling', () => {
    it('should return a success result on 202', async () => {
      mockedAxios.post.mockResolvedValue({ status: 202, data: '' });

      const result = await service.sendEmail(baseParams, API_KEY);

      expect(result).toMatchObject({ statusCode: 202, to: baseParams.to, subject: baseParams.subject });
    });

    it('should throw when no API key is provided', async () => {
      await expect(service.sendEmail(baseParams, '')).rejects.toThrow(
        'No SendGrid API key available',
      );
    });

    it('should throw when axios rejects', async () => {
      const axiosError = Object.assign(new Error('Network error'), {
        response: { status: 500, data: { errors: [{ message: 'Internal error' }] } },
      });
      mockedAxios.post.mockRejectedValue(axiosError);

      await expect(service.sendEmail(baseParams, API_KEY)).rejects.toThrow(
        'SendGrid API error',
      );
    });
  });
});
