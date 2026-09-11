import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO поверх Redis.
 *
 * Без адаптера сокет-сервер каждого инстанса API живёт сам по себе, и рассылка
 * в комнату доходит только до тех клиентов, которые случайно попали на этот
 * инстанс. Адаптер нужен с первого дня: добавить его после того, как
 * горизонтальное масштабирование уже включено, значит ловить «иногда алерт не
 * приходит» в проде.
 *
 * Фан-аут доменных событий при этом идёт через RealtimeBus, а рассылка внутри
 * инстанса — через `.local`, чтобы событие не размножилось: иначе каждый инстанс,
 * получив сообщение шины, разослал бы его всем остальным ещё раз.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];

  async connectToRedis(url: string): Promise<void> {
    const publisher = new Redis(url, { maxRetriesPerRequest: null });
    const subscriber = publisher.duplicate();
    this.clients = [publisher, subscriber];
    this.adapterConstructor = createAdapter(publisher, subscriber);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (factory: unknown) => void;
    };
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  override async close(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.quit().catch(() => undefined)));
  }
}
