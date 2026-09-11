import { Inject, Injectable } from '@nestjs/common';
import { dedupKey } from '@streamkit/contracts';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/** Сутки: дольше провайдеры события не переотправляют. */
const DEDUP_TTL_SECONDS = 24 * 60 * 60;

/**
 * Быстрая защита от повторной обработки одного и того же события.
 *
 * Порядок важен: проверка идёт ДО записи в БД и до отправки в сокет. Дубль
 * алерта видят зрители на стриме, поэтому «сначала показать, потом разобраться»
 * не годится.
 *
 * Redis тут — быстрый фильтр, а не источник правды: при его перезапуске ключи
 * теряются, и тогда срабатывает уникальный индекс `(provider, externalId, userId)`
 * в PostgreSQL. Две независимые линии защиты вместо одной.
 */
@Injectable()
export class DedupService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Помечает событие обработанным.
   * @returns true, если событие видим впервые; false — если это повтор.
   */
  async claim(userId: string, provider: string, externalId: string): Promise<boolean> {
    const key = `${dedupKey({ provider: provider as never, externalId })}:${userId}`;
    const result = await this.redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
    return result === 'OK';
  }

  /**
   * Снимает отметку. Нужен, когда запись в БД упала по причине, не связанной с
   * дублем: иначе событие останется «обработанным», и повторная попытка провайдера
   * будет молча отброшена.
   */
  async release(userId: string, provider: string, externalId: string): Promise<void> {
    const key = `${dedupKey({ provider: provider as never, externalId })}:${userId}`;
    await this.redis.del(key);
  }
}
