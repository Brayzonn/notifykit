import { Module } from '@nestjs/common';
import { FeatureGateService } from './feature-gate/feature-gate.service';

@Module({
  providers: [FeatureGateService],
  exports: [FeatureGateService],
})
export class CommonModule {}
