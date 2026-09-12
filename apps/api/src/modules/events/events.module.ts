import { Module } from '@nestjs/common';
import { WidgetsModule } from '../widgets/widgets.module';
import { DedupService } from './dedup.service';
import { EventsController, WebhookController } from './events.controller';
import { EventsService } from './events.service';
import { WebhookService } from './webhook.service';

/**
 * Зависимость на виджеты односторонняя: события пересчитывают состояние целей и
 * таймеров, виджеты о событиях ничего не знают. Цикла нет.
 */
@Module({
  imports: [WidgetsModule],
  controllers: [EventsController, WebhookController],
  providers: [EventsService, DedupService, WebhookService],
  exports: [EventsService],
})
export class EventsModule {}
