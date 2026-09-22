import type { RouletteSpin } from '@streamkit/contracts';
import { useCallback, useState } from 'react';

/**
 * Очередь прокрутов рулетки: два доната подряд крутят колесо дважды, по
 * очереди, а не перебивают друг друга на середине оборота.
 *
 * Не ограничена, как и очередь оповещений: прокрут оплачен донатом, и
 * пропустить его в кадре хуже, чем показать с задержкой.
 */
export function useRouletteQueue(): {
  current: RouletteSpin | null;
  enqueue: (spin: RouletteSpin) => void;
  finish: (spinId: string) => void;
} {
  const [queue, setQueue] = useState<RouletteSpin[]>([]);

  // Дубль по id — от переподключения сокета посреди доставки.
  const enqueue = useCallback((spin: RouletteSpin) => {
    setQueue((current) =>
      current.some((item) => item.id === spin.id) ? current : [...current, spin],
    );
  }, []);

  const finish = useCallback((spinId: string) => {
    setQueue((current) => current.filter((item) => item.id !== spinId));
  }, []);

  return { current: queue[0] ?? null, enqueue, finish };
}
