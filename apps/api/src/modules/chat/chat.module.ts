import { Injectable, Logger, Module } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CHAT_TICK_MS, ChatManager } from './chat-manager.service';
import { TwitchChatSource } from './twitch-chat.source';

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
  providers: [TwitchChatSource, ChatManager, ChatScheduler],
  exports: [ChatManager],
})
export class ChatModule {}
