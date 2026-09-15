import { Module } from '@nestjs/common';
import { RoomMediaModule } from '../rooms/room-media.module';
import { WidgetStateService } from './widget-state.service';
import { WidgetsController } from './widgets.controller';
import { WidgetsService } from './widgets.service';

@Module({
  imports: [RoomMediaModule],
  controllers: [WidgetsController],
  providers: [WidgetsService, WidgetStateService],
  exports: [WidgetsService, WidgetStateService],
})
export class WidgetsModule {}
