import { Module } from '@nestjs/common';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { SiteStatsController } from './site-stats.controller';

@Module({
  controllers: [PrivacyController, SiteStatsController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
