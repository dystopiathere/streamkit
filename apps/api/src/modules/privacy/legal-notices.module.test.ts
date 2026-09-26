import { describe, expect, it, vi } from 'vitest';
import type { RedisLock } from '../../common/redis/lock.service';
import { LegalNoticesScheduler } from './legal-notices.module';
import type { LegalUpdateNoticesService } from './legal-update-notices.service';

describe('рассылка о новых редакциях', () => {
  function scheduler(sendPending: () => Promise<number>) {
    const lock = {
      withLock: vi.fn((_key: string, _ttl: number, task: () => Promise<number>) => task()),
    };
    return {
      lock,
      scheduler: new LegalNoticesScheduler(
        { sendPending } as unknown as LegalUpdateNoticesService,
        lock as unknown as RedisLock,
      ),
    };
  }

  it('идёт сразу при запуске воркера, а не с первым тактом расписания', async () => {
    const sendPending = vi.fn(async () => 1);
    const { lock, scheduler: subject } = scheduler(sendPending);

    subject.onApplicationBootstrap();

    await vi.waitFor(() => expect(sendPending).toHaveBeenCalledTimes(1));
    // Под той же блокировкой, что и такт: реплики воркера стартуют вместе.
    expect(lock.withLock).toHaveBeenCalledWith(
      'streamkit:lock:legal-notices',
      expect.any(Number),
      expect.any(Function),
    );
  });

  it('сбой рассылки при запуске не роняет воркер', async () => {
    const sendPending = vi.fn(async () => {
      throw new Error('SMTP недоступен');
    });
    const { scheduler: subject } = scheduler(sendPending);

    expect(() => subject.onApplicationBootstrap()).not.toThrow();
    await vi.waitFor(() => expect(sendPending).toHaveBeenCalled());
  });
});
