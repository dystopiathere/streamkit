import { describe, expect, it } from 'vitest';
import { applyTimerAction, type TimerSnapshot } from './widget-state.service';

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

  it('досчитавший до нуля таймер не уходит в минус', () => {
    const expired: TimerSnapshot = { endsAt: '2026-09-12T11:00:00.000Z', pausedSeconds: null };
    expect(applyTimerAction(expired, 'pause', BOUNDS).pausedSeconds).toBe(0);
  });
});
