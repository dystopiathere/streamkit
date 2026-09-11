import { Module } from '@nestjs/common';
import { DedupService } from './dedup.service';
import { EventsController, WebhookController } from './events.controller';
import { EventsService } from './events.service';
import { WebhookService } from './webhook.service';

@Module({
  controllers: [EventsController, WebhookController],
  providers: [EventsService, DedupService, WebhookService],
  exports: [EventsService],
})
export class EventsModule {}
