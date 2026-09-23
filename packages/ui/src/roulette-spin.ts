import type { RouletteSpin, RouletteWidgetConfig } from '@streamkit/contracts';
import { useEffect, useRef, useState } from 'react';

/**
 * Такт прокрута, общий для колеса и для вертикальной ленты.
 *
 * Движение у них разное, а порядок один: показать прокрут, довести до итога,
 * подержать итог, убрать. Две копии этого порядка разошлись бы на первой же
 * правке — например, когда итог начнут держать дольше.
 */
export type SpinPhase = 'idle' | 'spinning' | 'result' | 'leaving';

/** Вход и уход рулетки, если она прячется между прокрутами, и уход итога. */
export const ENTER_MS = 320;
export const LEAVE_MS = 200;
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

/**
 * Замедление: сильный толчок и долгий выбег.
 *
 * Первая контрольная точка круто вверх — рулетка сразу набирает скорость после
 * замаха, вторая прижата к единице: последние доли тянутся, и зритель успевает
 * гадать, на чём она встанет. Стандартный `ease-out` тормозит равномерно и
 * выглядит как анимация, а не как рулетка.
 */
export const SPIN_EASING = 'cubic-bezier(0.12, 0.66, 0.08, 1)';
/** Замах назад перед прокрутом: доля длительности. */
export const WIND_UP_SHARE = 0.05;

/**
 * Запуск движения. Возвращает отмену: прерванный прокрут (виджет перенастроили,
 * сцену закрыли) обязан оставить рулетку там, где её застали, а не отбросить к
 * началу.
 *
 * `reduced` — человек попросил систему не двигать интерфейс: тогда рулетка
 * встаёт на итог сразу, но итог показывается так же, как после прокрута, —
 * смысл события не теряется вместе с движением.
 */
export type SpinRunner = (
  spin: RouletteSpin,
  finish: () => void,
  reduced: boolean,
) => (() => void) | void;

export function useSpinPhases(
  spin: RouletteSpin | null,
  config: Pick<RouletteWidgetConfig, 'resultMs'>,
  run: SpinRunner,
  onFinished?: (spinId: string) => void,
): { phase: SpinPhase; shown: RouletteSpin | null } {
  const [phase, setPhase] = useState<SpinPhase>('idle');
  const [shown, setShown] = useState<RouletteSpin | null>(null);
  const spinId = spin?.id ?? null;

  // Всё, что нужно эффекту из пропсов, — через ref: иначе правка конфига
  // посреди прокрута перезапускала бы эффект, и рулетка дёргалась бы к началу.
  // Прокрут идёт по конфигу, с которым начался.
  const latest = useRef({ spin, config, run, onFinished });
  useEffect(() => {
    latest.current = { spin, config, run, onFinished };
  });

  useEffect(() => {
    if (!spinId) return;
    const { spin: current, config: settings, run: start } = latest.current;
    if (!current) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    // Итог показывается следующим тактом, а не сразу: движение без анимации
    // (уменьшенное движение, старый браузер) заканчивается в том же такте, в
    // котором прокрут только начался, — и «встали на итоге» пришло бы раньше,
    // чем «крутимся».
    const finish = (): void => {
      timers.push(
        setTimeout(() => {
          setPhase('result');
          timers.push(
            setTimeout(() => {
              setPhase('leaving');
              timers.push(
                setTimeout(() => {
                  setPhase('idle');
                  latest.current.onFinished?.(current.id);
                }, LEAVE_MS),
              );
            }, settings.resultMs),
          );
        }, 0),
      );
    };

    timers.push(
      setTimeout(() => {
        setShown(current);
        setPhase('spinning');
      }, 0),
    );

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cancel = start(current, finish, reduced);

    return () => {
      for (const timer of timers) clearTimeout(timer);
      cancel?.();
    };
  }, [spinId]);

  return { phase, shown };
}

/**
 * Цвет подписи сектора — тёмный или светлый, какой контрастнее.
 *
 * Стример задаёт цвет сектора сам, а белая подпись на жёлтом секторе не
 * читается даже с обводкой. Относительная яркость по WCAG.
 */
export function labelColor(hex: string): string {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  const onDark = 1.05 / (luminance + 0.05);
  const onLight = (luminance + 0.05) / 0.055;
  return onLight >= onDark ? '#100F0D' : '#FFFFFF';
}
