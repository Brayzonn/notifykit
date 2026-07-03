import { Test, TestingModule } from '@nestjs/testing';
import {
  PlatformEmailProcessor,
  PlatformEmailJobData,
} from './platform-email.processor';
import { PlatformEmailSenderService } from '@/email-providers/platform-email-sender.service';
import { SlackService } from '@/common/slack/slack.service';
import { PrismaService } from '@/prisma/prisma.service';

const LOG_ID = 'log-abc-123';

function makeJob(
  overrides: Partial<{ attemptsMade: number; maxAttempts: number }> = {},
) {
  const { attemptsMade = 0, maxAttempts = 3 } = overrides;
  return {
    data: {
      logId: LOG_ID,
      to: 'user@example.com',
      subject: 'Verify your email',
      html: '<p>code</p>',
      label: 'otp',
    } satisfies PlatformEmailJobData,
    attemptsMade,
    opts: { attempts: maxAttempts },
  } as any;
}

describe('PlatformEmailProcessor', () => {
  let processor: PlatformEmailProcessor;
  let sender: jest.Mocked<PlatformEmailSenderService>;
  let slack: jest.Mocked<SlackService>;
  let prisma: { platformEmailLog: { update: jest.Mock } };

  beforeEach(async () => {
    sender = { send: jest.fn() } as any;
    slack = { alert: jest.fn() } as any;
    prisma = {
      platformEmailLog: { update: jest.fn().mockResolvedValue(undefined) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformEmailProcessor,
        { provide: PlatformEmailSenderService, useValue: sender },
        { provide: SlackService, useValue: slack },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    processor = module.get(PlatformEmailProcessor);
  });

  // ── Send ──────────────────────────────────────────────────────────────────

  it('sends the email via PlatformEmailSenderService', async () => {
    sender.send.mockResolvedValue(undefined);
    await processor.process(makeJob());
    expect(sender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Verify your email',
      html: '<p>code</p>',
    });
  });

  // ── Success logging ───────────────────────────────────────────────────────

  it('marks the log SENT with sentAt and attempts on success', async () => {
    sender.send.mockResolvedValue(undefined);
    await processor.process(makeJob({ attemptsMade: 0 }));
    expect(prisma.platformEmailLog.update).toHaveBeenCalledWith({
      where: { id: LOG_ID },
      data: { status: 'SENT', attempts: 1, sentAt: expect.any(Date) },
    });
  });

  it('does not alert Slack on success', async () => {
    sender.send.mockResolvedValue(undefined);
    await processor.process(makeJob({ attemptsMade: 2, maxAttempts: 3 }));
    expect(slack.alert).not.toHaveBeenCalled();
  });

  // ── Failure logging ───────────────────────────────────────────────────────

  it('re-throws on failure so BullMQ can retry', async () => {
    sender.send.mockRejectedValue(new Error('provider down'));
    await expect(processor.process(makeJob())).rejects.toThrow('provider down');
  });

  it('updates attempts and errorMessage on an intermediate failure', async () => {
    sender.send.mockRejectedValue(new Error('provider down'));
    await expect(
      processor.process(makeJob({ attemptsMade: 0, maxAttempts: 3 })),
    ).rejects.toThrow();
    expect(prisma.platformEmailLog.update).toHaveBeenCalledWith({
      where: { id: LOG_ID },
      data: { attempts: 1, errorMessage: 'provider down' },
    });
  });

  it('does not set status FAILED on an intermediate failure', async () => {
    sender.send.mockRejectedValue(new Error('provider down'));
    await expect(
      processor.process(makeJob({ attemptsMade: 0, maxAttempts: 3 })),
    ).rejects.toThrow();
    const updateCall = prisma.platformEmailLog.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it('sets status FAILED on the final attempt', async () => {
    sender.send.mockRejectedValue(new Error('all providers down'));
    await expect(
      processor.process(makeJob({ attemptsMade: 2, maxAttempts: 3 })),
    ).rejects.toThrow();
    expect(prisma.platformEmailLog.update).toHaveBeenCalledWith({
      where: { id: LOG_ID },
      data: {
        attempts: 3,
        errorMessage: 'all providers down',
        status: 'FAILED',
      },
    });
  });

  it('does not alert Slack on an intermediate failure', async () => {
    sender.send.mockRejectedValue(new Error('provider down'));
    await expect(
      processor.process(makeJob({ attemptsMade: 0, maxAttempts: 3 })),
    ).rejects.toThrow();
    expect(slack.alert).not.toHaveBeenCalled();
  });

  it('fires a Slack alert on the final failed attempt', async () => {
    sender.send.mockRejectedValue(new Error('all providers down'));
    await expect(
      processor.process(makeJob({ attemptsMade: 2, maxAttempts: 3 })),
    ).rejects.toThrow();
    expect(slack.alert).toHaveBeenCalledTimes(1);
    const call = slack.alert.mock.calls[0][0];
    expect(call.title).toContain('Platform Email Failed');
    expect(call.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Type', value: 'otp' }),
        expect.objectContaining({
          label: 'Recipient',
          value: 'user@example.com',
        }),
        expect.objectContaining({
          label: 'Error',
          value: 'all providers down',
        }),
        expect.objectContaining({ label: 'Attempts', value: '3 / 3' }),
      ]),
    );
  });
});
