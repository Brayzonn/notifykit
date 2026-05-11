import { Module } from '@nestjs/common';
import { FeatureGateService } from './feature-gate/feature-gate.service';
import { SlackService } from './slack/slack.service';

@Module({
  providers: [FeatureGateService, SlackService],
  exports: [FeatureGateService, SlackService],
})
export class CommonModule {}
