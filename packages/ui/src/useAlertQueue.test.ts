import type { AlertEvent } from '@streamkit/contracts';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_EXIT_DURATION_MS } from './alert-animations';
import { useAlertQueue } from './useAlertQueue';

const CONFIG = { durationMs: 1000, gapMs: 200 };
/** Полный цикл одного показа: держим → уходим → пауза перед следующим. */
const CYCLE_MS = CONFIG.durationMs + ALERT_EXIT_DURATION_MS + CONFIG.gapMs;

function event(id: string): AlertEvent {
  return {
    id,
    userId: '00000000-0000-4000-8000-000000000001',
    type: 'donation',
    provider: 'webhook',
    externalId: id,
    username: 'Зритель',
    message: '',
    amount: { amountMinor: 10_000, currency: 'RUB' },
    isTest: false,
    createdAt: new Date().toISOString(),
  };
}

describe('useAlertQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('показывает алерты по одному и в порядке поступления', () => {
    const { result } = renderHook(() => useAlertQueue(CONFIG));

    act(() => {
      result.current.enqueue(event('первый'));
      result.current.enqueue(event('второй'));
    });

    expect(result.current.current?.event.id).toBe('первый');

    act(() => void vi.advanceTimersByTime(CYCLE_MS));
    expect(result.current.current?.event.id).toBe('второй');

    act(() => void vi.advanceTimersByTime(CYCLE_MS));
    expect(result.current.current).toBeNull();
  });

  it('не накапливает таймеры за длинный стрим', () => {
    const { result } = renderHook(() => useAlertQueue(CONFIG));

    // Цепочка показа строго последовательна, поэтому в любой момент времени
    // отложенный вызов должен быть ровно один. Раньше тайм-ауты складывались в
    // массив и очищались лишь при размонтировании — а страница оверлея в OBS
    // живёт весь стрим и не перезагружается между сценами.
    for (let i = 0; i < 20; i += 1) {
      act(() => {
        result.current.enqueue(event(`алерт-${i}`));
      });
      act(() => void vi.advanceTimersByTime(CYCLE_MS));
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    }
  });

  it('снимает таймер при размонтировании', () => {
    const { result, unmount } = renderHook(() => useAlertQueue(CONFIG));

    act(() => {
      result.current.enqueue(event('единственный'));
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('сообщает, сколько алертов ждёт очереди', () => {
    const { result } = renderHook(() => useAlertQueue(CONFIG));

    act(() => {
      result.current.enqueue(event('a'));
      result.current.enqueue(event('b'));
      result.current.enqueue(event('c'));
    });

    // Первый уже на экране, в очереди остались двое.
    expect(result.current.pending).toBe(2);
  });
});
