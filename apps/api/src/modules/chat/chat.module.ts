import { Injectable, Logger, Module } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { HttpClient } from '../../common/http/http-client.service';
import { QuotaService } from '../analytics/quota.service';
import { EventsModule } from '../events/events.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CHAT_TICK_MS, ChatManager } from './chat-manager.service';
import { TwitchChatSource } from './twitch-chat.source';
import { YouTubeChatSource } from './youtube-chat.source';

/**
 * Такт чата: подтвердить владение соединением и свести состав каналов.
 *
 * Расписание отдельным классом от сервиса — тот же приём, что у опроса
 * аналитики и ночной уборки: так такт можно дёрнуть из теста и руками, не
 * дожидаясь таймера.
 *
 * Без `RedisLock.withLock` вокруг, в отличие от них, и это не забывчивость.
 * Уборка и опрос обязаны выполниться один раз на кластер И ЗАВЕРШИТЬСЯ; чат —
 * долгоживущее соединение, которое кто-то один обязан ДЕРЖАТЬ. Владение живёт
 * внутри `ChatManager` и продлевается каждым тактом.
 */
@Injectable()
export class ChatScheduler {
  private readonly logger = new Logger(ChatScheduler.name);

  constructor(private readonly chat: ChatManager) {}

  @Interval(CHAT_TICK_MS)
  async tick(): Promise<void> {
    try {
      await this.chat.tick();
    } catch (error) {
      // Упавший такт не должен ронять воркер: следующий попробует снова, а
      // живые донат-коннекторы важнее чата.
      this.logger.error({ err: error }, 'Такт чата не выполнен');
    }
  }
}

/**
 * Чтение чата площадок.
 *
 * Подключается ТОЛЬКО воркером — по той же причине, что и донат-коннекторы:
 * в API этот модуль рвал и поднимал бы соединение при каждом деплое, а инстансов
 * API может быть несколько.
 */
@Module({
  // Токены YouTube — из интеграций: чат читается токеном владельца канала.
  // Счётчик квоты — тот же, что у метрик: лимит Google общий на проект.
  // События — из ленты событий: спонсорства и суперчаты YouTube приходят
  // строками потока чата, и записывает их тот же сервис, что вебхук.
  imports: [IntegrationsModule, EventsModule],
  providers: [
    TwitchChatSource,
    YouTubeChatSource,
    HttpClient,
    QuotaService,
    ChatManager,
    ChatScheduler,
  ],
  exports: [ChatManager],
})
export class ChatModule {}
