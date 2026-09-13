import { Module } from '@nestjs/common';
import { WidgetsModule } from '../widgets/widgets.module';
import {
  LiveKitRoomMediaServer,
  LiveKitTokens,
  LiveKitWebhooks,
  ROOM_MEDIA_SERVER,
} from './livekit.service';
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
  imports: [WidgetsModule],
  controllers: [RoomsController, OverlayRoomController, LiveKitWebhookController],
  providers: [
    RoomsService,
    LiveKitTokens,
    LiveKitWebhooks,
    { provide: ROOM_MEDIA_SERVER, useClass: LiveKitRoomMediaServer },
  ],
})
export class RoomsModule {}
