import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { AppConfig } from '../../config/app-config.service';

/**
 * Сутки квоты — по тихоокеанскому времени, как их считает Google.
 *
 * Раньше сутки считались по UTC. Полночь UTC — это пять вечера в Калифорнии:
 * исчерпав квоту, опрос ждал полночи UTC, получал от Google тот же отказ (у
 * Google сутки ещё не кончились) и откладывался снова до следующей полночи
 * UTC — метрики YouTube не собирались лишние шестнадцать часов. Зона задана
 * явно, а не берётся у сервера: ключ обязан совпадать на всех инстансах.
 */
const QUOTA_TIME_ZONE = 'America/Los_Angeles';

const QUOTA_CLOCK = new Intl.DateTimeFormat('en-CA', {
  timeZone: QUOTA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const DAY_SECONDS = 24 * 60 * 60;

/** Дата и прошедшие секунды суток по часам квоты. */
function quotaClock(now: Date): { day: string; seconds: number } {
  const part: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = Object.fromEntries(
    QUOTA_CLOCK.formatToParts(now).map((item) => [item.type, item.value]),
  );
  return {
    day: `${part.year}-${part.month}-${part.day}`,
    seconds: Number(part.hour) * 3600 + Number(part.minute) * 60 + Number(part.second),
  };
}

/** Ключ счётчика на сутки. Живёт с запасом, чтобы пережить смену суток. */
export function quotaKey(platform: string, now: Date = new Date()): string {
  return `streamkit:quota:${platform}:${quotaClock(now).day}`;
}

/**
 * Ближайшая полночь по тихоокеанскому времени — когда Google обнуляет квоту.
 *
 * Сутки в дни перевода часов длятся 23 или 25 часов, поэтому «плюс остаток
 * суток» проверяется по тем же часам и доводится до настоящей полуночи.
 */
export function nextQuotaReset(now: Date): Date {
  const elapsedMs = quotaClock(now).seconds * 1000 + now.getUTCMilliseconds();
  const guess = new Date(now.getTime() + DAY_SECONDS * 1000 - elapsedMs);
  const off = quotaClock(guess).seconds;
  if (off === 0) return guess;
  return new Date(guess.getTime() + (off >= DAY_SECONDS / 2 ? DAY_SECONDS - off : -off) * 1000);
}

const KEY_TTL_SECONDS = 36 * 60 * 60;

/**
 * Бюджет чата YouTube — отдельный счётчик из того же лимита проекта Google.
 * Отдельный, чтобы чат одного шестичасового эфира не остановил сбор метрик
 * всем стримерам (docs/adr/0014).
 */
export const YOUTUBE_CHAT_QUOTA = 'youtube-chat';

/**
 * Учёт суточной квоты внешнего API.
 *
 * Нужен из-за особенности YouTube Data API: лимит в 10 000 единиц выдаётся на
 * ПРОЕКТ, а не на пользователя, и делится между всеми стримерами платформы
 * сразу. Google не сообщает остаток в ответах — узнать об исчерпании можно
 * только получив 403 `quotaExceeded`, то есть уже потратив всё. Поэтому считаем
 * сами и останавливаемся заранее.
 *
 * Счётчик в Redis, а не в памяти: воркер может быть не один, а квота общая.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfig,
  ) {}

  /**
   * Резервирует `cost` единиц под предстоящий запрос.
   *
   * Резерв ДО запроса, а не списание после: списание после означало бы, что
   * превышение обнаруживается уже потраченным. Цена — потерянные единицы при
   * упавшем запросе, и это правильный размен.
   *
   * @returns false, если бюджет на сутки исчерпан.
   */
  async reserve(platform: string, cost: number): Promise<boolean> {
    if (cost <= 0) return true;

    const limit = this.limitFor(platform);
    if (limit <= 0) return true;

    const key = quotaKey(platform);
    const used = await this.redis.incrby(key, cost);

    // TTL ставится безусловно, с флагом NX. Раньше — только когда `used === cost`,
    // то есть после первого инкремента: разрыв связи с Redis ровно в этом окне
    // оставлял ключ без срока НАВСЕГДА, счётчик упирался в лимит и больше
    // никогда не обнулялся — сбор метрик YouTube не возобновлялся и назавтра.
    await this.redis.expire(key, KEY_TTL_SECONDS, 'NX');

    if (used > limit) {
      this.logger.warn({ platform, used, limit }, 'Суточная квота площадки исчерпана');
      return false;
    }
    return true;
  }

  /**
   * Признать бюджет исчерпанным по слову самой площадки.
   *
   * Наш счётчик — оценка, и она заведомо ниже правды: стоимость запросов взята
   * из документации, а подключение канала и обновление токена мимо резерва
   * проходят вовсе. Когда Google отвечает `quotaExceeded`, спорить не с чем —
   * счётчик подтягивается к лимиту, чтобы остаток суток не тратился на запросы,
   * которые заведомо не получатся.
   */
  async exhaust(platform: string): Promise<void> {
    // Лимит у Google один на проект: исчерпан он — исчерпаны и метрики, и чат,
    // с чьего бы запроса об этом ни стало известно.
    const budgets = platform.startsWith('youtube') ? ['youtube', YOUTUBE_CHAT_QUOTA] : [platform];
    for (const budget of budgets) {
      const limit = this.limitFor(budget);
      if (limit <= 0) continue;
      await this.redis.set(quotaKey(budget), limit + 1, 'EX', KEY_TTL_SECONDS);
    }
    this.logger.warn({ platform }, 'Площадка сообщила об исчерпании квоты, счётчик выровнен');
  }

  /** 0 означает «квоты нет» — так у Twitch, там только лимит частоты. */
  private limitFor(platform: string): number {
    if (platform === 'youtube') return this.config.youtubeDailyQuota;
    if (platform === YOUTUBE_CHAT_QUOTA) return this.config.youtubeChatDailyQuota;
    return 0;
  }
}
