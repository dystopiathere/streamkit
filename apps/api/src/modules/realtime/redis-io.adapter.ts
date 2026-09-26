import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { IncomingMessage } from 'node:http';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { SocketAdmission, type SocketAdmissionLimits } from './socket-admission';

/**
 * Потолок одного сообщения от клиента. По умолчанию у Socket.IO мегабайт, а
 * клиенты шлют только короткие служебные события: мегабайт на сообщение — это
 * мегабайт памяти на разбор с каждого сокета, который его пришлёт.
 */
const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;

/** То, что нужно от сокета Engine.IO: сам пакет не в зависимостях API. */
interface EngineSocket {
  request: IncomingMessage;
  once(event: 'close', listener: () => void): unknown;
}

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
  private admission?: SocketAdmission;
  private clients: Redis[] = [];

  async connectToRedis(url: string, limits: SocketAdmissionLimits): Promise<void> {
    const publisher = new Redis(url, { maxRetriesPerRequest: null });
    const subscriber = publisher.duplicate();
    this.clients = [publisher, subscriber];
    this.adapterConstructor = createAdapter(publisher, subscriber);
    // Счётчики — через publisher: подписчик в режиме подписки обычных
    // команд не выполняет.
    this.admission = new SocketAdmission(publisher, limits);
  }

  /**
   * Nest вызывает это один раз на порт, остальные namespace открываются на том
   * же сервере, — поэтому допуск на уровне Engine.IO покрывает и оверлей, и
   * дашборд.
   */
  override createIOServer(port: number, options?: ServerOptions): unknown {
    const admission = this.admission;
    const server = super.createIOServer(port, {
      ...options,
      maxHttpBufferSize: MAX_CLIENT_MESSAGE_BYTES,
      ...(admission ? { allowRequest: admission.allowRequest } : {}),
    } as ServerOptions) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    if (admission) {
      server.engine.on('connection', (socket: EngineSocket) => {
        socket.once('close', admission.opened(socket.request));
      });
    }
    return server;
  }

  override async close(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.quit().catch(() => undefined)));
  }
}
