import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { WidgetsModule } from '../widgets/widgets.module';
import { LiveKitTokens, LiveKitWebhooks } from './livekit.service';
import { RoomMediaModule } from './room-media.module';
import {
  LiveKitWebhookController,
  OverlayRoomController,
  RoomsController,
} from './rooms.controller';
import { RoomsService } from './rooms.service';

/**
 * Приватные комнаты. Только в API: здесь HTTP и выдача токенов, долгоживущих
 * соединений нет — медиа держит LiveKit, а не наш процесс.
 */
@Module({
  imports: [WidgetsModule, RoomMediaModule, BillingModule],
  controllers: [RoomsController, OverlayRoomController, LiveKitWebhookController],
  providers: [RoomsService, LiveKitTokens, LiveKitWebhooks],
  exports: [RoomsService],
})
export class RoomsModule {}
