import { Test, TestingModule } from '@nestjs/testing';
import { PlatformEmailProcessor, PlatformEmailJobData } from './platform-email.processor';
import { PlatformEmailSenderService } from '@/email-providers/platform-email-sender.service';
import { SlackService } from '@/common/slack/slack.service';

function makeJob(overrides: Partial<{ attemptsMade: number; maxAttempts: number }> = {}) {
  const { attemptsMade = 0, maxAttempts = 3 } = overrides;
  return {
    data: {
      to: 'user@example.com',
      subject: 'Verify your email',
      html: '<p>code</p>',
      label: 'OTP',
    } satisfies PlatformEmailJobData,
    attemptsMade,
    opts: { attempts: maxAttempts },
  } as any;
}

describe('PlatformEmailProcessor', () => {
  let processor: PlatformEmailProcessor;
  let sender: jest.Mocked<PlatformEmailSenderService>;
  let slack: jest.Mocked<SlackService>;

  beforeEach(async () => {
    sender = { send: jest.fn() } as any;
    slack = { alert: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformEmailProcessor,
        { provide: PlatformEmailSenderService, useValue: sender },
        { provide: SlackService, useValue: slack },
      ],
    }).compile();

    processor = module.get(PlatformEmailProcessor);
  });

  it('sends the email via PlatformEmailSenderService', async () => {
    sender.send.mockResolvedValue(undefined);
    await processor.process(makeJob());
    expect(sender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Verify your email',
      html: '<p>code</p>',
    });
  });

  it('re-throws on failure so BullMQ can retry', async () => {
    sender.send.mockRejectedValue(new Error('provider down'));
    await expect(processor.process(makeJob())).rejects.toThrow('provider down');
  });

  it('does not alert Slack on an intermediate failure', async () => {
    sender.send.mockRejectedValue(new Error('provider down'));
    await expect(processor.process(makeJob({ attemptsMade: 0, maxAttempts: 3 }))).rejects.toThrow();
    expect(slack.alert).not.toHaveBeenCalled();
  });

  it('fires a Slack alert on the final failed attempt', async () => {
    sender.send.mockRejectedValue(new Error('all providers down'));
    await expect(processor.process(makeJob({ attemptsMade: 2, maxAttempts: 3 }))).rejects.toThrow();
    expect(slack.alert).toHaveBeenCalledTimes(1);
    const call = slack.alert.mock.calls[0][0];
    expect(call.title).toContain('Platform Email Failed');
    expect(call.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Type', value: 'OTP' }),
        expect.objectContaining({ label: 'Recipient', value: 'user@example.com' }),
        expect.objectContaining({ label: 'Error', value: 'all providers down' }),
        expect.objectContaining({ label: 'Attempts', value: '3 / 3' }),
      ]),
    );
  });

  it('does not alert Slack on success', async () => {
    sender.send.mockResolvedValue(undefined);
    await processor.process(makeJob({ attemptsMade: 2, maxAttempts: 3 }));
    expect(slack.alert).not.toHaveBeenCalled();
  });
});
