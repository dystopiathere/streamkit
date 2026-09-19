import { Inject, Injectable } from '@nestjs/common';
import {
  type ChatChannelRef,
  chatChannelKey,
  chatChannelRefSchema,
  type ChatState,
  chatStateSchema,
} from '@streamkit/contracts';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

/** Каналы чата, которые сейчас смотрят из окна эфира. */
const CHAT_WATCH_KEY = 'streamkit:presence:chat-watch';
/** Состояние чтения чата канала, которое пишет воркер: `<префикс><площадка>:<канал>`. */
const CHAT_STATE_PREFIX = 'streamkit:chat-state:';
/**
 * Срок отметки состояния. Воркер обновляет её каждый такт (10 с): состояние
 * упавшего воркера не должно висеть в окне эфира как правда.
 */
const CHAT_STATE_TTL_SECONDS = 30;
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

  /** Окно эфира открыто и показывает чат этих каналов. */
  async watchChats(refs: ChatChannelRef[]): Promise<void> {
    if (refs.length === 0) return;
    const expiresAt = Date.now() + PRESENCE_TTL_MS;
    await this.redis.zadd(
      CHAT_WATCH_KEY,
      ...refs.flatMap((ref) => [expiresAt, chatChannelKey(ref)]),
    );
  }

  /**
   * Каналы, чей чат нужен хотя бы одному открытому окну эфира.
   *
   * Отметка — строка `площадка:канал`, и при чтении она снова проходит схему:
   * из неё воркер собирает команду IRC, а строку в Redis мог оставить и старый
   * код с другим форматом.
   */
  async watchedChats(): Promise<ChatChannelRef[]> {
    const refs: ChatChannelRef[] = [];
    for (const key of await this.alive(CHAT_WATCH_KEY)) {
      const separator = key.indexOf(':');
      const ref = chatChannelRefSchema.safeParse({
        platform: key.slice(0, separator),
        channel: key.slice(separator + 1),
      });
      if (separator > 0 && ref.success) refs.push(ref.data);
    }
    return refs;
  }

  /** Воркер: что происходит с чтением чата канала. */
  async setChatStates(states: Array<[ChatChannelRef, ChatState]>): Promise<void> {
    if (states.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const [ref, state] of states) {
      pipeline.set(CHAT_STATE_PREFIX + chatChannelKey(ref), state, 'EX', CHAT_STATE_TTL_SECONDS);
    }
    await pipeline.exec();
  }

  /** Состояния каналов по отметкам воркера; нет отметки — нет и ключа в ответе. */
  async chatStates(refs: ChatChannelRef[]): Promise<Map<string, ChatState>> {
    const result = new Map<string, ChatState>();
    if (refs.length === 0) return result;
    const keys = refs.map((ref) => chatChannelKey(ref));
    const values = await this.redis.mget(...keys.map((key) => CHAT_STATE_PREFIX + key));
    keys.forEach((key, index) => {
      const state = chatStateSchema.safeParse(values[index]);
      if (state.success) result.set(key, state.data);
    });
    return result;
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
