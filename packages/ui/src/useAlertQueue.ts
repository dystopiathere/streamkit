import type { AlertEvent, AlertWidgetConfig } from '@streamkit/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ALERT_EXIT_DURATION_MS } from './alert-animations';

export interface QueuedAlert {
  event: AlertEvent;
  /** Идёт анимация ухода — компонент должен применить exit-анимацию. */
  isLeaving: boolean;
}

/**
 * Очередь показа алертов.
 *
 * Без очереди три доната подряд накладываются друг на друга, и зритель не видит
 * ни одного. Правила простые: показываем строго по одному, следующий — только
 * после паузы `gapMs`, порядок не меняем.
 *
 * Очередь не ограничена по длине специально: потерять донат на стриме хуже, чем
 * показать его с задержкой. Рейд из сотни событий — забота фильтров на бэкенде.
 */
export function useAlertQueue(config: Pick<AlertWidgetConfig, 'gapMs' | 'scenarios'>): {
  current: QueuedAlert | null;
  enqueue: (event: AlertEvent) => void;
  pending: number;
} {
  const [current, setCurrent] = useState<QueuedAlert | null>(null);
  const [pending, setPending] = useState(0);

  const queue = useRef<AlertEvent[]>([]);
  /**
   * Ровно один отложенный вызов за раз.
   *
   * Цепочка показа строго последовательна: держать пауза → уход → пауза, и
   * каждый следующий таймер ставится только когда предыдущий уже сработал.
   * Раньше здесь был массив, куда тайм-ауты только добавлялись, а очищался он
   * лишь при размонтировании — но страница оверлея в OBS не перезагружается
   * между сценами, и за долгий стрим там копились тысячи мёртвых записей.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Идёт показ. Флаг в ref, а не в состоянии: он нужен синхронно внутри колбэка. */
  const isBusy = useRef(false);

  // Актуальные тайминги держим в ref, чтобы смена конфига не пересоздавала
  // колбэки и не роняла уже идущий показ.
  const timings = useRef(config);
  useEffect(() => {
    timings.current = config;
  }, [config]);

  /**
   * Ссылка на саму себя: цепочка показов рекурсивна, а `useCallback` не может
   * сослаться на собственный результат в своём теле.
   */
  const showNextRef = useRef<() => void>(() => undefined);

  const schedule = useCallback((callback: () => void, delay: number) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      callback();
    }, delay);
  }, []);

  const showNext = useCallback(() => {
    const next = queue.current.shift();
    setPending(queue.current.length);

    if (!next) {
      isBusy.current = false;
      setCurrent(null);
      return;
    }

    isBusy.current = true;
    setCurrent({ event: next, isLeaving: false });

    // Время на экране — у сценария типа события: фолловера показывают коротко,
    // крупный донат — дольше.

    schedule(() => {
      setCurrent((active) => (active ? { ...active, isLeaving: true } : null));

      schedule(() => {
        setCurrent(null);
        schedule(() => showNextRef.current(), timings.current.gapMs);
      }, ALERT_EXIT_DURATION_MS);
    }, timings.current.scenarios[next.type].durationMs);
  }, [schedule]);

  useEffect(() => {
    showNextRef.current = showNext;
  }, [showNext]);

  const enqueue = useCallback((event: AlertEvent) => {
    queue.current.push(event);
    setPending(queue.current.length);

    // Запуск идёт напрямую, а не из функции обновления состояния: React может
    // вызвать её дважды (StrictMode, повторный рендер), и тогда один и тот же
    // алерт стартовал бы дважды.
    if (!isBusy.current) {
      showNextRef.current();
    }
  }, []);

  // Таймер обязательно снимается: при отключении сокета и размонтировании
  // компонент иначе продолжит дёргать состояние и уронит страницу в OBS.
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    },
    [],
  );

  return { current, enqueue, pending };
}
