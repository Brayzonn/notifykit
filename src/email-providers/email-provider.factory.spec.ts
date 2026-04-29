import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CustomerPlan, EmailProviderType } from '@prisma/client';
import { EmailProviderFactory } from './email-provider.factory';
import { SendGridService } from '@/sendgrid/sendgrid.service';
import { ResendService } from './resend.service';
import { PostmarkService } from './postmark.service';

describe('EmailProviderFactory', () => {
  let factory: EmailProviderFactory;
  let sendGrid: SendGridService;
  let resend: ResendService;
  let postmark: PostmarkService;
  let env: Record<string, string | undefined>;

  beforeEach(async () => {
    env = {};
    sendGrid = { sendEmail: jest.fn() } as unknown as SendGridService;
    resend = { sendEmail: jest.fn() } as unknown as ResendService;
    postmark = { sendEmail: jest.fn() } as unknown as PostmarkService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProviderFactory,
        { provide: SendGridService, useValue: sendGrid },
        { provide: ResendService, useValue: resend },
        { provide: PostmarkService, useValue: postmark },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => env[key]) },
        },
      ],
    }).compile();

    factory = module.get(EmailProviderFactory);
  });

  describe('FREE plan (shared platform keys)', () => {
    it('returns no providers when none of the env keys are set', () => {
      expect(() => factory.resolveAll(CustomerPlan.FREE, [])).toThrow(
        'No shared email provider configured',
      );
    });

    it('returns only SendGrid when only SENDGRID_API_KEY is set', () => {
      env.SENDGRID_API_KEY = 'sg-key';
      const result = factory.resolveAll(CustomerPlan.FREE, []);
      expect(result).toEqual([{ provider: sendGrid, apiKey: 'sg-key' }]);
    });

    it('returns Postmark when only POSTMARK_API_KEY is set', () => {
      env.POSTMARK_API_KEY = 'pm-key';
      const result = factory.resolveAll(CustomerPlan.FREE, []);
      expect(result).toEqual([{ provider: postmark, apiKey: 'pm-key' }]);
    });

    it('returns SendGrid, Resend, Postmark in declared order when all three are set', () => {
      env.SENDGRID_API_KEY = 'sg';
      env.RESEND_API_KEY = 're';
      env.POSTMARK_API_KEY = 'pm';

      const result = factory.resolveAll(CustomerPlan.FREE, []);
      expect(result).toEqual([
        { provider: sendGrid, apiKey: 'sg' },
        { provider: resend, apiKey: 're' },
        { provider: postmark, apiKey: 'pm' },
      ]);
    });
  });

  describe('Paid plans (per-customer providers)', () => {
    it('throws when no customer providers are configured', () => {
      expect(() => factory.resolveAll(CustomerPlan.INDIE, [])).toThrow(
        'No email provider configured. Please add an API key in settings.',
      );
    });

    it('resolves a single Postmark provider config', () => {
      const result = factory.resolveAll(CustomerPlan.STARTUP, [
        { provider: EmailProviderType.POSTMARK, apiKey: 'pm-key', priority: 1 },
      ]);
      expect(result).toEqual([{ provider: postmark, apiKey: 'pm-key' }]);
    });

    it('orders multiple providers by ascending priority', () => {
      const result = factory.resolveAll(CustomerPlan.STARTUP, [
        { provider: EmailProviderType.POSTMARK, apiKey: 'pm', priority: 3 },
        { provider: EmailProviderType.SENDGRID, apiKey: 'sg', priority: 1 },
        { provider: EmailProviderType.RESEND, apiKey: 're', priority: 2 },
      ]);
      expect(result).toEqual([
        { provider: sendGrid, apiKey: 'sg' },
        { provider: resend, apiKey: 're' },
        { provider: postmark, apiKey: 'pm' },
      ]);
    });

    it('throws on an unsupported provider type', () => {
      expect(() =>
        factory.resolveAll(CustomerPlan.STARTUP, [
          {
            provider: 'MAILGUN' as unknown as EmailProviderType,
            apiKey: 'mg',
            priority: 1,
          },
        ]),
      ).toThrow('Unsupported email provider: MAILGUN');
    });
  });
});
