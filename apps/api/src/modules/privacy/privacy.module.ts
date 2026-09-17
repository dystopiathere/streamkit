import { Module } from '@nestjs/common';
import { RoomMediaModule } from '../rooms/room-media.module';
import { WidgetsModule } from '../widgets/widgets.module';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { SiteStatsController } from './site-stats.controller';

@Module({
  imports: [WidgetsModule, RoomMediaModule],
  controllers: [PrivacyController, SiteStatsController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
