import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { AppConfig } from '../../config/app-config.service';

/**
 * Ключ счётчика на сутки. Живёт с запасом, чтобы пережить смену дня по UTC.
 *
 * Сутки считаем по UTC, потому что именно так их считает Google: квота
 * сбрасывается в полночь по тихоокеанскому времени, но привязываться к местной
 * зоне сервера точно неправильно — она может быть какой угодно.
 */
export function quotaKey(platform: string, now: Date = new Date()): string {
  return `streamkit:quota:${platform}:${now.toISOString().slice(0, 10)}`;
}

const KEY_TTL_SECONDS = 36 * 60 * 60;

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

    // TTL ставится после первого инкремента: ключ создаётся самим INCRBY, и без
    // срока он остался бы навсегда, а счётчик — вечным.
    if (used === cost) {
      await this.redis.expire(key, KEY_TTL_SECONDS);
    }

    if (used > limit) {
      this.logger.warn({ platform, used, limit }, 'Суточная квота площадки исчерпана');
      return false;
    }
    return true;
  }

  /** Сколько единиц уже потрачено за сегодня. Для диагностики. */
  async used(platform: string): Promise<number> {
    const value = await this.redis.get(quotaKey(platform));
    return Number(value ?? 0);
  }

  /** 0 означает «квоты нет» — так у Twitch, там только лимит частоты. */
  private limitFor(platform: string): number {
    return platform === 'youtube' ? this.config.youtubeDailyQuota : 0;
  }
}
