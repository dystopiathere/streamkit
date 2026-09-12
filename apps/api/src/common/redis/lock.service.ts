import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

/**
 * Снятие блокировки сравнивает значение перед удалением.
 *
 * Без сравнения возможен классический сценарий: процесс A взял блокировку,
 * задумался дольше TTL, блокировка истекла, её взял процесс B — и тут A
 * просыпается и удаляет ключ, который ему уже не принадлежит. Проверка и
 * удаление обязаны быть одной операцией, поэтому это Lua, а не GET + DEL.
 */
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/**
 * Взаимное исключение между процессами поверх Redis.
 *
 * Нужно там, где задача по расписанию обязана выполниться один раз на весь
 * кластер, а не по разу в каждой реплике: ночная уборка конкурировала бы сама с
 * собой за одни и те же строки, а опрос площадок тратил бы отдельную квоту
 * внешнего API на каждую реплику.
 *
 * Это НЕ распределённый лок общего назначения: при разрыве сети между Redis и
 * держателем блокировка истечёт по TTL, и задача может пойти дважды. Для уборки
 * и опроса это приемлемо — обе идемпотентны. Для денежных операций понадобится
 * что-то с фехтованием (fencing token).
 */
@Injectable()
export class RedisLock {
  private readonly logger = new Logger(RedisLock.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Выполняет `fn`, если блокировка получена.
   *
   * @returns результат `fn`, либо `null` — блокировку держит кто-то другой.
   *          `null` это штатный исход, а не ошибка: работу делает другая реплика.
   */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const token = randomUUID();
    const acquired = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') {
      this.logger.debug({ key }, 'Блокировка занята, задача пропущена');
      return null;
    }

    try {
      return await fn();
    } finally {
      // Падение снятия не должно подменять собой исходную ошибку: ключ всё
      // равно истечёт по TTL.
      await this.redis
        .eval(RELEASE_SCRIPT, 1, key, token)
        .catch((error: unknown) =>
          this.logger.warn({ err: error, key }, 'Не удалось снять блокировку'),
        );
    }
  }
}
