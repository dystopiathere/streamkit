import { Module } from '@nestjs/common';
import { LiveKitRoomMediaServer, ROOM_MEDIA_SERVER } from './livekit.service';

/**
 * Серверный API медиасервера — отдельным модулем.
 *
 * Им пользуются и комнаты, и виджеты: отзыв ссылки OBS обязан выгнать из
 * комнаты уже подключённый оверлей, иначе держатель утёкшей ссылки смотрел бы
 * гостей и после отзыва. Комнаты сами зависят от виджетов, поэтому провайдер
 * живёт здесь, а не в `RoomsModule`: иначе зависимость стала бы круговой.
 */
@Module({
  providers: [{ provide: ROOM_MEDIA_SERVER, useClass: LiveKitRoomMediaServer }],
  exports: [ROOM_MEDIA_SERVER],
})
export class RoomMediaModule {}
