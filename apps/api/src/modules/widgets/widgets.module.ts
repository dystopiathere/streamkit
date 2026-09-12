import { Module } from '@nestjs/common';
import { WidgetStateService } from './widget-state.service';
import { WidgetsController } from './widgets.controller';
import { WidgetsService } from './widgets.service';

@Module({
  controllers: [WidgetsController],
  providers: [WidgetsService, WidgetStateService],
  exports: [WidgetsService, WidgetStateService],
})
export class WidgetsModule {}
