import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PlatformEmailSenderService } from './platform-email-sender.service';
import { ResendService } from './resend/resend.service';
import { SendGridService } from './sendgrid/sendgrid.service';
import { PostmarkService } from './postmark/postmark.service';

const params = { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' };

function buildModule(env: Record<string, string>) {
  const resend = { sendEmail: jest.fn() } as unknown as ResendService;
  const sendgrid = { sendEmail: jest.fn() } as unknown as SendGridService;
  const postmark = { sendEmail: jest.fn() } as unknown as PostmarkService;

  return Test.createTestingModule({
    providers: [
      PlatformEmailSenderService,
      { provide: ResendService, useValue: resend },
      { provide: SendGridService, useValue: sendgrid },
      { provide: PostmarkService, useValue: postmark },
      {
        provide: ConfigService,
        useValue: { get: jest.fn((key: string, fallback = '') => env[key] ?? fallback) },
      },
    ],
  })
    .compile()
    .then((module) => ({
      service: module.get(PlatformEmailSenderService),
      resend,
      sendgrid,
      postmark,
    }));
}

describe('PlatformEmailSenderService', () => {
  describe('provider resolution', () => {
    it('uses only providers whose API keys are set', async () => {
      const { service, resend, sendgrid } = await buildModule({ RESEND_API_KEY: 're_key' });
      (resend.sendEmail as jest.Mock).mockResolvedValue(undefined);

      await service.send(params);

      expect(resend.sendEmail).toHaveBeenCalledTimes(1);
      expect(sendgrid.sendEmail).not.toHaveBeenCalled();
    });

    it('throws when no providers are configured', async () => {
      const { service } = await buildModule({});
      await expect(service.send(params)).rejects.toThrow('All platform email providers failed');
    });
  });

  describe('priority order', () => {
    it('tries Resend before SendGrid before Postmark', async () => {
      const order: string[] = [];
      const { service, resend, sendgrid, postmark } = await buildModule({
        RESEND_API_KEY: 're_key',
        SENDGRID_API_KEY: 'sg_key',
        POSTMARK_API_KEY: 'pm_key',
      });

      (resend.sendEmail as jest.Mock).mockImplementation(() => { order.push('resend'); return Promise.resolve(); });
      (sendgrid.sendEmail as jest.Mock).mockImplementation(() => { order.push('sendgrid'); return Promise.resolve(); });
      (postmark.sendEmail as jest.Mock).mockImplementation(() => { order.push('postmark'); return Promise.resolve(); });

      await service.send(params);

      expect(order).toEqual(['resend']);
      expect(sendgrid.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('fallback behaviour', () => {
    it('falls back to SendGrid when Resend fails', async () => {
      const { service, resend, sendgrid } = await buildModule({
        RESEND_API_KEY: 're_key',
        SENDGRID_API_KEY: 'sg_key',
      });
      (resend.sendEmail as jest.Mock).mockRejectedValue(new Error('resend down'));
      (sendgrid.sendEmail as jest.Mock).mockResolvedValue(undefined);

      await service.send(params);

      expect(resend.sendEmail).toHaveBeenCalledTimes(1);
      expect(sendgrid.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('falls back to Postmark when Resend and SendGrid both fail', async () => {
      const { service, resend, sendgrid, postmark } = await buildModule({
        RESEND_API_KEY: 're_key',
        SENDGRID_API_KEY: 'sg_key',
        POSTMARK_API_KEY: 'pm_key',
      });
      (resend.sendEmail as jest.Mock).mockRejectedValue(new Error('resend down'));
      (sendgrid.sendEmail as jest.Mock).mockRejectedValue(new Error('sendgrid down'));
      (postmark.sendEmail as jest.Mock).mockResolvedValue(undefined);

      await service.send(params);

      expect(postmark.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('throws with all provider errors when every provider fails', async () => {
      const { service, resend, sendgrid } = await buildModule({
        RESEND_API_KEY: 're_key',
        SENDGRID_API_KEY: 'sg_key',
      });
      (resend.sendEmail as jest.Mock).mockRejectedValue(new Error('resend down'));
      (sendgrid.sendEmail as jest.Mock).mockRejectedValue(new Error('sendgrid down'));

      await expect(service.send(params)).rejects.toThrow('resend: resend down');
    });
  });
});
