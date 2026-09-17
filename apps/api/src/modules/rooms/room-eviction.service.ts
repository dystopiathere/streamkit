import { Inject, Injectable, Logger } from '@nestjs/common';
import { ROOM_MEDIA_SERVER, type RoomMediaServer } from './livekit.service';

/**
 * Опустошить комнаты на медиасервере: стример, гости, оверлеи.
 *
 * Нужна там, где доступ пропадает у всех участников разом — блокировка и
 * обезличивание аккаунта. Выданный токен LiveKit не отзывается, и без этого шага
 * уже подключённые продолжали бы созвон: вебхук проверяет только вход.
 */
@Injectable()
export class RoomEviction {
  private readonly logger = new Logger(RoomEviction.name);

  constructor(@Inject(ROOM_MEDIA_SERVER) private readonly media: RoomMediaServer) {}

  async emptyRooms(roomIds: string[]): Promise<void> {
    await Promise.all(roomIds.map((roomId) => this.emptyRoom(roomId)));
  }

  private async emptyRoom(roomId: string): Promise<void> {
    try {
      const participants = await this.media.listParticipants(roomId);
      await Promise.all(
        participants.map((participant) =>
          this.media.removeParticipant(roomId, participant.identity),
        ),
      );
    } catch (error) {
      // Отказ медиасервера не отменяет блокировку: запись в БД сделана, и
      // повторный вход не пройдёт проверку по вебхуку. Но молча не глотаем.
      this.logger.error({ err: error, roomId }, 'Комната не опустошена');
    }
  }
}
