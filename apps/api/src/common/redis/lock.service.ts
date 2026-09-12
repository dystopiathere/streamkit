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

/** Сколько раз ждём освобождения занятой блокировки и с каким шагом. */
const WAIT_ATTEMPTS = 20;
const WAIT_STEP_MS = 100;

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
    const token = await this.acquire(key, ttlMs);
    if (!token) {
      this.logger.debug({ key }, 'Блокировка занята, задача пропущена');
      return null;
    }

    try {
      return await fn();
    } finally {
      await this.release(key, token);
    }
  }

  /**
   * Выполняет `fn`, ДОЖДАВШИСЬ освобождения блокировки.
   *
   * Отличие от `withLock` не в механике, а в смысле отказа. Там «занято»
   * означает «работу делает другая реплика, и делать её второй раз не нужно» —
   * уборка и опрос идемпотентны. Здесь занято означает «ту же строку прямо
   * сейчас меняет кто-то другой», и пропустить работу нельзя: это потерянный
   * донат, а не сэкономленный запрос.
   *
   * Ожидание ограничено, и при неудаче метод бросает. Применить изменение
   * поверх чужого молча — ровно та потеря, ради которой блокировка заводилась.
   *
   * Возвращаемое значение `fn` здесь не перегружено смыслом «занято», в отличие
   * от `withLock`: ожидание устроено вокруг самой блокировки, а не вокруг
   * результата, поэтому `fn` вправе вернуть и `null`.
   */
  async withLockWaiting<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
    options: { attempts?: number; stepMs?: number } = {},
  ): Promise<T> {
    const attempts = options.attempts ?? WAIT_ATTEMPTS;
    const stepMs = options.stepMs ?? WAIT_STEP_MS;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const token = await this.acquire(key, ttlMs);
      if (token) {
        try {
          return await fn();
        } finally {
          await this.release(key, token);
        }
      }
      await sleep(stepMs);
    }

    throw new Error(`Не удалось получить блокировку ${key} за ${attempts} попыток`);
  }

  /** @returns токен владения, либо null — ключ занят. */
  private async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const acquired = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return acquired === 'OK' ? token : null;
  }

  private async release(key: string, token: string): Promise<void> {
    // Падение снятия не должно подменять собой исходную ошибку: ключ всё
    // равно истечёт по TTL.
    await this.redis
      .eval(RELEASE_SCRIPT, 1, key, token)
      .catch((error: unknown) =>
        this.logger.warn({ err: error, key }, 'Не удалось снять блокировку'),
      );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
