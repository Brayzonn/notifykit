import { Test, TestingModule } from '@nestjs/testing';
import { SendGridService } from './sendgrid.service';
import { ConfigService } from '@nestjs/config';
import { CustomerPlan } from '@prisma/client';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const SHARED_KEY = 'SG.shared_key';
const CUSTOMER_KEY = 'SG.customer_key';
const DEFAULT_FROM = 'noreply@notifykit.dev';

const createConfigService = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string, defaultValue?: string) => {
    const config: Record<string, string> = {
      SENDGRID_API_KEY: SHARED_KEY,
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
  let configService: ReturnType<typeof createConfigService>;

  beforeEach(async () => {
    configService = createConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendGridService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SendGridService>(SendGridService);
    mockedAxios.post.mockResolvedValue({ status: 202, data: '' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Plan / key routing ───────────────────────────────────────────────────────

  describe('API key routing', () => {
    it('should use the shared key for FREE plan when no customer key is provided', async () => {
      await service.sendEmail(baseParams, undefined, CustomerPlan.FREE);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${SHARED_KEY}` }),
        }),
      );
    });

    it('should use a customer-provided key when one is passed', async () => {
      await service.sendEmail(baseParams, CUSTOMER_KEY, CustomerPlan.INDIE);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${CUSTOMER_KEY}` }),
        }),
      );
    });

    it('should throw for INDIE plan when no customer key is provided', async () => {
      await expect(service.sendEmail(baseParams, undefined, CustomerPlan.INDIE)).rejects.toThrow(
        'SendGrid API key required for paid plans',
      );
    });

    it('should throw for STARTUP plan when no customer key is provided', async () => {
      await expect(service.sendEmail(baseParams, undefined, CustomerPlan.STARTUP)).rejects.toThrow(
        'SendGrid API key required for paid plans',
      );
    });

    it('should throw when no key is available at all (no shared key, no customer key, FREE plan)', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SendGridService,
          { provide: ConfigService, useValue: createConfigService({ SENDGRID_API_KEY: '' }) },
        ],
      }).compile();
      const noKeyService = module.get<SendGridService>(SendGridService);

      await expect(noKeyService.sendEmail(baseParams, undefined, CustomerPlan.FREE)).rejects.toThrow(
        'No SendGrid API key available',
      );
    });

    it('should prefer the customer key over the shared key even for FREE plan', async () => {
      await service.sendEmail(baseParams, CUSTOMER_KEY, CustomerPlan.FREE);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${CUSTOMER_KEY}` }),
        }),
      );
    });
  });

  // ── Request construction ─────────────────────────────────────────────────────

  describe('Request construction', () => {
    it('should POST to the SendGrid mail/send endpoint', async () => {
      await service.sendEmail(baseParams, undefined, CustomerPlan.FREE);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.sendgrid.com/v3/mail/send',
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should build the correct SendGrid payload', async () => {
      await service.sendEmail({ ...baseParams, from: 'custom@example.com' }, undefined, CustomerPlan.FREE);

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
      await service.sendEmail(baseParams, undefined, CustomerPlan.FREE);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ from: { email: DEFAULT_FROM } }),
        expect.any(Object),
      );
    });

    it('should send with Content-Type: application/json', async () => {
      await service.sendEmail(baseParams, undefined, CustomerPlan.FREE);

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
    it('should return { statusCode } on success', async () => {
      mockedAxios.post.mockResolvedValue({ status: 202, data: '' });

      const result = await service.sendEmail(baseParams, undefined, CustomerPlan.FREE);

      expect(result).toEqual({ statusCode: 202 });
    });

    it('should throw when axios rejects', async () => {
      const axiosError = Object.assign(new Error('Network error'), {
        response: { status: 500, data: { errors: [{ message: 'Internal error' }] } },
      });
      mockedAxios.post.mockRejectedValue(axiosError);

      await expect(service.sendEmail(baseParams, undefined, CustomerPlan.FREE)).rejects.toThrow(
        'SendGrid API error',
      );
    });
  });
});
