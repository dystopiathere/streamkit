import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { RedisLock } from './lock.service';

/**
 * Redis здесь подменён намеренно: проверяется решение «бежать или уступить» и
 * гарантии снятия блокировки, а не поведение самого Redis. Атомарность `SET NX`
 * и Lua-скрипта — забота сервера, её проверять моком бессмысленно.
 */
function fakeRedis(setResult: 'OK' | null) {
  const calls: { set: unknown[][]; eval: unknown[][] } = { set: [], eval: [] };
  const redis = {
    set: vi.fn((...args: unknown[]) => {
      calls.set.push(args);
      return Promise.resolve(setResult);
    }),
    eval: vi.fn((...args: unknown[]) => {
      calls.eval.push(args);
      return Promise.resolve(1);
    }),
  } as unknown as Redis;
  return { redis, calls };
}

describe('RedisLock', () => {
  it('выполняет работу, когда блокировка получена', async () => {
    const { redis } = fakeRedis('OK');
    const lock = new RedisLock(redis);

    await expect(lock.withLock('ключ', 1000, async () => 'готово')).resolves.toBe('готово');
  });

  it('ставит ключ с NX и временем жизни — без них блокировка ничего не значит', async () => {
    const { redis, calls } = fakeRedis('OK');
    await new RedisLock(redis).withLock('streamkit:lock:тест', 55_000, async () => undefined);

    expect(calls.set[0]?.slice(1)).toEqual([expect.any(String), 'PX', 55_000, 'NX']);
  });

  it('возвращает null и не трогает работу, если ключ занят другой репликой', async () => {
    const { redis } = fakeRedis(null);
    const work = vi.fn();

    const result = await new RedisLock(redis).withLock('ключ', 1000, async () => {
      work();
      return 'готово';
    });

    expect(result).toBeNull();
    expect(work).not.toHaveBeenCalled();
  });

  it('снимает блокировку после успеха', async () => {
    const { redis, calls } = fakeRedis('OK');
    await new RedisLock(redis).withLock('ключ', 1000, async () => undefined);

    expect(calls.eval).toHaveLength(1);
  });

  it('снимает блокировку и после падения работы, не проглатывая ошибку', async () => {
    const { redis, calls } = fakeRedis('OK');

    await expect(
      new RedisLock(redis).withLock('ключ', 1000, () => Promise.reject(new Error('упало'))),
    ).rejects.toThrow('упало');
    expect(calls.eval).toHaveLength(1);
  });

  it('снимает блокировку по значению, а не просто удаляя ключ', async () => {
    const { redis, calls } = fakeRedis('OK');
    await new RedisLock(redis).withLock('ключ', 1000, async () => undefined);

    // Токен, переданный в скрипт снятия, обязан совпадать с записанным при
    // захвате: иначе процесс, переживший истечение TTL, снимет чужую блокировку.
    const written = calls.set[0]?.[1];
    expect(calls.eval[0]?.[3]).toBe(written);
  });

  it('падение снятия не подменяет собой результат работы', async () => {
    const { redis } = fakeRedis('OK');
    vi.mocked(redis.eval).mockRejectedValueOnce(new Error('redis недоступен'));

    await expect(new RedisLock(redis).withLock('ключ', 1000, async () => 42)).resolves.toBe(42);
  });
});
