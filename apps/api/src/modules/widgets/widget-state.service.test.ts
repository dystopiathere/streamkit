import { describe, expect, it, vi } from 'vitest';
import {
  applyTimerAction,
  type StoredTimer,
  type TimerSnapshot,
  WidgetStateService,
} from './widget-state.service';

const NOW = new Date('2026-09-12T12:00:00.000Z').getTime();

const BOUNDS = { nowMs: NOW, initialSeconds: 3600, maxSeconds: 7200, seconds: 0 };

const stopped: TimerSnapshot = { endsAt: null, pausedSeconds: null };
const paused: TimerSnapshot = { endsAt: null, pausedSeconds: 600 };
const running: TimerSnapshot = { endsAt: '2026-09-12T12:10:00.000Z', pausedSeconds: null };

/**
 * Таймер марафона: арифметика над двумя полями.
 *
 * Хранится момент окончания, а не счётчик — счётчик в браузере уезжает на
 * каждой подлагивающей сцене OBS, а момент окончания переживает и перезагрузку
 * сцены, и перезапуск сервера.
 */
describe('переходы таймера', () => {
  it('запускает никогда не запускавшийся с начальной длительности', () => {
    const next = applyTimerAction(stopped, 'start', BOUNDS);
    expect(next.endsAt).toBe(new Date(NOW + 3600_000).toISOString());
    expect(next.pausedSeconds).toBeNull();
  });

  it('продолжает с паузы, а не с начала', () => {
    const next = applyTimerAction(paused, 'start', BOUNDS);
    expect(next.endsAt).toBe(new Date(NOW + 600_000).toISOString());
  });

  it('пауза сохраняет остаток', () => {
    expect(applyTimerAction(running, 'pause', BOUNDS).pausedSeconds).toBe(600);
  });

  it('пауза на остановленном таймере ничего не меняет', () => {
    expect(applyTimerAction(paused, 'pause', BOUNDS)).toEqual(paused);
  });

  it('сброс останавливает, а не перезапускает', () => {
    // Иначе «сбросить» посреди марафона запускало бы новый отсчёт, которого
    // никто не просил, и зрители видели бы это на экране.
    const next = applyTimerAction(running, 'reset', BOUNDS);
    expect(next).toEqual({ endsAt: null, pausedSeconds: 3600 });
  });

  it('добавляет время идущему таймеру', () => {
    const next = applyTimerAction(running, 'add', { ...BOUNDS, seconds: 300 });
    expect(next.endsAt).toBe(new Date(NOW + 900_000).toISOString());
  });

  it('не теряет донат на незапущенном таймере', () => {
    // Первые донаты марафона приходят до того, как стример нажал «Запустить».
    // Молча их терять нельзя — время копится на остановленных часах.
    const next = applyTimerAction(stopped, 'add', { ...BOUNDS, seconds: 300 });
    expect(next).toEqual({ endsAt: null, pausedSeconds: 3900 });
  });

  it('упирается в потолок', () => {
    // Марафон не должен продлеваться бесконечно одним крупным донатом.
    const next = applyTimerAction(running, 'add', { ...BOUNDS, seconds: 100_000 });
    expect(next.endsAt).toBe(new Date(NOW + BOUNDS.maxSeconds * 1000).toISOString());
  });

  it('потолок не укорачивает уже идущий таймер', () => {
    // Начальная длительность и потолок задаются независимо, и «не больше шести
    // часов» легко поставить марафону, заведённому на двенадцать. Донат обязан
    // в худшем случае не изменить ничего — но никак не срезать половину
    // марафона на глазах зрителей.
    const long: TimerSnapshot = { endsAt: null, pausedSeconds: 43_200 };
    const next = applyTimerAction(long, 'add', { ...BOUNDS, maxSeconds: 21_600, seconds: 300 });
    expect(next.pausedSeconds).toBe(43_200);
  });

  it('досчитавший до нуля таймер не уходит в минус', () => {
    const expired: TimerSnapshot = { endsAt: '2026-09-12T11:00:00.000Z', pausedSeconds: null };
    expect(applyTimerAction(expired, 'pause', BOUNDS).pausedSeconds).toBe(0);
  });
});

/**
 * Порядок публикаций при параллельных донатах.
 *
 * Через HTTP эта гонка почти не воспроизводится — окно в миллисекунды. Здесь
 * оно раздвинуто искусственно: подсчёт снимка первого доната медленный. Если
 * публикация живёт вне блокировки, второй донат успевает записать и
 * опубликовать «плюс две минуты», а запоздавшая публикация первого приходит
 * последней и возвращает на экран «плюс минуту».
 */
describe('команды таймера под блокировкой', () => {
  it('последняя публикация совпадает с последней записью', async () => {
    let stored: StoredTimer = { endsAt: null, pausedSeconds: 600 };
    const published: number[] = [];

    // Блокировка в памяти: строгая очередь, как у Redis-версии при ожидании.
    let tail: Promise<unknown> = Promise.resolve();
    const lock = {
      withLockWaiting: <T>(_key: string, _ttl: number, fn: () => Promise<T>): Promise<T> => {
        const run = tail.then(fn);
        tail = run.catch(() => undefined);
        return run;
      },
    };
    const bus = {
      publish: async (message: { state: { pausedSeconds: number } }) => {
        published.push(message.state.pausedSeconds);
      },
    };

    const service = new WidgetStateService({} as never, bus as never, lock as never);
    vi.spyOn(service, 'readTimer').mockImplementation(async () => stored);
    vi.spyOn(service, 'write').mockImplementation(async (_id, state) => {
      stored = state as StoredTimer;
    });

    let calls = 0;
    vi.spyOn(service, 'compute').mockImplementation(async () => {
      calls += 1;
      const snapshot = stored.pausedSeconds;
      if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 30));
      return { kind: 'timer', pausedSeconds: snapshot } as never;
    });

    const widget = { id: 'w1', type: 'TIMER', config: { maxSeconds: 86_400 } } as never;
    await Promise.all([
      service.applyTimerAction(widget, 'add', 60),
      service.applyTimerAction(widget, 'add', 60),
    ]);

    expect(stored.pausedSeconds).toBe(720);
    expect(published).toEqual([660, 720]);
  });
});
