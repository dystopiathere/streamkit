import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

/** Лимиты допуска сокетов. */
export interface SocketAdmissionLimits {
  /** Новых подключений в минуту с одного IP — на весь кластер. */
  handshakesPerMinute: number;
  /** Одновременно открытых подключений с одного IP — на одну реплику API. */
  connectionsPerIp: number;
}

const WINDOW_SECONDS = 60;

/**
 * Допуск подключений Socket.IO до namespace и до проверки токена.
 *
 * Лимитер Nest (`ThrottlerGuard`) стоит на HTTP-контроллерах, а рукопожатие
 * Engine.IO идёт мимо них. Без этого слоя поток подключений с одного адреса
 * ничем не ограничен, и каждое из них — поиск токена оверлея в базе или
 * проверка JWT. Проверяется только рукопожатие: сообщения уже открытого сокета
 * сюда не попадают.
 *
 * Счёт новых подключений — в Redis, чтобы лимит не умножался на число реплик.
 * Открытые подключения живут в процессе, поэтому и считаются в нём: счётчик в
 * Redis остался бы завышенным навсегда после падения реплики.
 *
 * Сбой Redis подключение пропускает: без Redis не работает и адаптер
 * Socket.IO, а отказ всем оверлеям разом хуже, чем минута без лимита.
 */
export class SocketAdmission {
  private readonly logger = new Logger(SocketAdmission.name);
  private readonly open = new Map<string, number>();

  constructor(
    private readonly redis: Redis,
    private readonly limits: SocketAdmissionLimits,
  ) {}

  /**
   * Решение по рукопожатию. Подпись — `allowRequest` у Engine.IO.
   *
   * @param request запрос рукопожатия
   * @param callback `(null, true)` — пустить, `(код, false)` — отказать
   */
  allowRequest = (
    request: IncomingMessage,
    callback: (error: string | null | undefined, success: boolean) => void,
  ): void => {
    void this.admit(clientIp(request)).then((allowed) =>
      callback(allowed ? null : 'Too many connections', allowed),
    );
  };

  /** Сокет открыт: учесть его в числе открытых с этого адреса. */
  opened(request: IncomingMessage): () => void {
    const ip = clientIp(request);
    this.open.set(ip, (this.open.get(ip) ?? 0) + 1);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const left = (this.open.get(ip) ?? 1) - 1;
      if (left > 0) this.open.set(ip, left);
      else this.open.delete(ip);
    };
  }

  /** Сколько сокетов с адреса открыто на этой реплике. */
  openFrom(ip: string): number {
    return this.open.get(ip) ?? 0;
  }

  private async admit(ip: string): Promise<boolean> {
    if (this.openFrom(ip) >= this.limits.connectionsPerIp) return false;
    try {
      const key = `streamkit:ws-handshake:${ip}`;
      // Одной транзакцией: срок, выставленный отдельной командой, не встал бы
      // при обрыве связи между ними, и ключ остался бы вечным.
      const result = await this.redis.multi().incr(key).expire(key, WINDOW_SECONDS, 'NX').exec();
      const count = Number(result?.[0]?.[1] ?? 0);
      return count <= this.limits.handshakesPerMinute;
    } catch (error) {
      this.logger.warn({ err: error }, 'Лимит подключений не проверен');
      return true;
    }
  }
}

/**
 * Адрес посетителя за Caddy.
 *
 * `trust proxy` Express сюда не доходит: Engine.IO получает голый
 * `IncomingMessage`. Берётся ПОСЛЕДНИЙ адрес `X-Forwarded-For` — его дописал
 * наш прокси; всё левее прислал клиент и могло быть подделано.
 */
export function clientIp(request: IncomingMessage): string {
  const header = request.headers['x-forwarded-for'];
  const forwarded = Array.isArray(header) ? header.join(',') : header;
  const last = forwarded?.split(',').at(-1)?.trim();
  return last || request.socket.remoteAddress || 'unknown';
}
