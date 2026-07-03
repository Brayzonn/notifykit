import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SlackService } from './slack.service';

const payload = {
  title: 'Test Alert',
  fields: [
    { label: 'Type', value: 'OTP' },
    { label: 'Recipient', value: 'user@example.com' },
  ],
};

async function buildService(webhookUrl?: string): Promise<SlackService> {
  const module = await Test.createTestingModule({
    providers: [
      SlackService,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) =>
            key === 'SLACK_WEBHOOK_URL' ? webhookUrl : undefined,
          ),
        },
      },
    ],
  }).compile();
  return module.get(SlackService);
}

describe('SlackService', () => {
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ status: 200 });
  });

  afterEach(() => jest.restoreAllMocks());

  it('posts a Block Kit message to the webhook URL', async () => {
    const service = await buildService('https://hooks.slack.com/test');
    await service.alert(payload);

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body] = postSpy.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/test');
    expect(body).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({ type: 'header' }),
        expect.objectContaining({ type: 'section' }),
      ]),
    });
  });

  it('includes all fields in the section block', async () => {
    const service = await buildService('https://hooks.slack.com/test');
    await service.alert(payload);

    const body = postSpy.mock.calls[0][1];
    const section = body.blocks.find((b: any) => b.type === 'section');
    expect(section.fields).toHaveLength(2);
    expect(section.fields[0].text).toContain('OTP');
    expect(section.fields[1].text).toContain('user@example.com');
  });

  it('is a no-op when SLACK_WEBHOOK_URL is not set', async () => {
    const service = await buildService(undefined);
    await service.alert(payload);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('swallows axios errors so a Slack outage never crashes the caller', async () => {
    const service = await buildService('https://hooks.slack.com/test');
    postSpy.mockRejectedValue(new Error('network timeout'));

    await expect(service.alert(payload)).resolves.toBeUndefined();
  });
});
