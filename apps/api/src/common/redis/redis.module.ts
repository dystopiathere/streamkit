import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Redis } from 'ioredis';
import { AppConfig } from '../../config/app-config.service';

/** Основной клиент: команды (дедуп, лимиты, кэш). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
/** Клиент под publish: отдельный, потому что подписчик блокирует соединение. */
export const REDIS_PUBLISHER = Symbol('REDIS_PUBLISHER');
/** Клиент под subscribe. */
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');

/**
 * Три отдельных соединения — не избыточность.
 *
 * Соединение в режиме подписки не может выполнять обычные команды: Redis
 * отвечает на них ошибкой. Поэтому publish и subscribe разведены, а третий
 * клиент обслуживает обычные операции (дедупликация, rate limit).
 */
function createClient(url: string, role: 'command' | 'subscriber'): Redis {
  return new Redis(url, {
    // BullMQ и подписки требуют отключённого лимита ретраев, иначе команды
    // начинают падать при коротком обрыве связи вместо ожидания переподключения.
    maxRetriesPerRequest: null,

    // Ready-check отправляет INFO. Для соединения-подписчика это запрещённая
    // команда: клиент получает ошибку, НЕ переходит в состояние ready и молча
    // теряет подписку. Симптом крайне неприятный — `publish` возвращает 0
    // получателей, никто не падает, а события просто не доходят.
    enableReadyCheck: role === 'command',
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => createClient(config.redisUrl, 'command'),
    },
    {
      provide: REDIS_PUBLISHER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => createClient(config.redisUrl, 'command'),
    },
    {
      provide: REDIS_SUBSCRIBER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => createClient(config.redisUrl, 'subscriber'),
    },
  ],
  exports: [REDIS_CLIENT, REDIS_PUBLISHER, REDIS_SUBSCRIBER],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  /** Закрываем соединения явно, иначе процесс не завершится по SIGTERM. */
  async onApplicationShutdown(): Promise<void> {
    for (const token of [REDIS_CLIENT, REDIS_PUBLISHER, REDIS_SUBSCRIBER]) {
      const client = this.moduleRef.get<Redis>(token, { strict: false });
      await client.quit().catch(() => undefined);
    }
  }
}
