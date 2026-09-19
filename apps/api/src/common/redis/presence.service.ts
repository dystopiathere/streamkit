import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

/** Каналы чата, которые сейчас смотрят из окна эфира. */
const CHAT_WATCH_KEY = 'streamkit:presence:chat-watch';
/** Ссылки OBS, чей оверлей сейчас подключён. */
const OVERLAY_KEY = 'streamkit:presence:overlay';

/**
 * Сколько живёт отметка без продления.
 *
 * Окно эфира продлевает её каждые 30 секунд, шлюз оверлея — тоже. Запас в три
 * такта: одна пропущенная отметка (переподключение сокета, пауза вкладки) не
 * должна гасить чат или «подключённый» OBS.
 */
export const PRESENCE_TTL_MS = 90_000;
export const PRESENCE_REFRESH_MS = 30_000;

/**
 * Кто сейчас на связи — общее знание всех реплик API и воркера.
 *
 * Сокеты живут в процессах API, а чат читает воркер: без общего места он не
 * узнал бы, что канал кому-то нужен. Отметки — элементы отсортированного
 * множества со сроком в качестве веса, а не ключи с TTL: одно множество читается
 * одной командой, а не перебором ключей (`SCAN` по всему Redis на каждый такт).
 * Просроченные вычищаются при чтении.
 */
@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Окно эфира открыто и показывает чат канала `channel`. */
  async watchChat(channel: string): Promise<void> {
    await this.redis.zadd(CHAT_WATCH_KEY, Date.now() + PRESENCE_TTL_MS, channel);
  }

  /** Каналы, чей чат нужен хотя бы одному открытому окну эфира. */
  async watchedChats(): Promise<Set<string>> {
    return new Set(await this.alive(CHAT_WATCH_KEY));
  }

  /** Оверлеи этих ссылок подключены — продление отметки. */
  async markOverlays(tokenIds: string[]): Promise<void> {
    if (tokenIds.length === 0) return;
    const expiresAt = Date.now() + PRESENCE_TTL_MS;
    await this.redis.zadd(OVERLAY_KEY, ...tokenIds.flatMap((id) => [expiresAt, id]));
  }

  /** Оверлей отключился. Если по этой ссылке открыт второй, его реплика вернёт отметку тактом позже. */
  async dropOverlay(tokenId: string): Promise<void> {
    await this.redis.zrem(OVERLAY_KEY, tokenId);
  }

  /** Какие из ссылок сейчас подключены. */
  async onlineOverlays(tokenIds: string[]): Promise<Set<string>> {
    if (tokenIds.length === 0) return new Set();
    const now = Date.now();
    const scores = await this.redis.zmscore(OVERLAY_KEY, ...tokenIds);
    return new Set(tokenIds.filter((_, index) => Number(scores[index] ?? 0) > now));
  }

  private async alive(key: string): Promise<string[]> {
    const now = Date.now();
    await this.redis.zremrangebyscore(key, '-inf', now);
    return this.redis.zrangebyscore(key, now, '+inf');
  }
}
