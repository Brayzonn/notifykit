import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SlackAlertPayload {
  title: string;
  fields: { label: string; value: string }[];
}

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private readonly webhookUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.webhookUrl = this.config.get<string>('SLACK_WEBHOOK_URL');
    if (!this.webhookUrl) {
      this.logger.warn('SLACK_WEBHOOK_URL not set — Slack alerts disabled');
    }
  }

  async alert(payload: SlackAlertPayload): Promise<void> {
    if (!this.webhookUrl) return;

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: payload.title, emoji: true },
      },
      {
        type: 'section',
        fields: payload.fields.map((f) => ({
          type: 'mrkdwn',
          text: `*${f.label}*\n${f.value}`,
        })),
      },
    ];

    try {
      await axios.post(this.webhookUrl, { blocks });
    } catch (err) {
      this.logger.error(
        `Failed to send Slack alert: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
