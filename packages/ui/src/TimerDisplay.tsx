import {
  type TimerState,
  type TimerWidgetConfig,
  formatDuration,
  timerRemainingSeconds,
} from '@streamkit/contracts';
import { useEffect, useState } from 'react';
import { textStyleToCss } from './text-style';

export interface TimerDisplayProps {
  config: TimerWidgetConfig;
  /** null — сервер ещё не прислал состояние. */
  state: TimerState | null;
}

/**
 * Табло таймера.
 *
 * Отсчёт идёт ЛОКАЛЬНО от присланного момента окончания, а не тиками с сервера:
 * иначе минута эфира стоила бы шестидесяти сообщений на каждый открытый
 * браузер-сорс, и любая просадка сети выглядела бы как замерший таймер.
 *
 * Поправка на расхождение часов считается один раз при получении состояния.
 * Машина с OBS и сервер расходятся на что угодно — от секунд до минут, — и без
 * поправки таймер врёт ровно на эту разницу, причём заметить это можно только
 * сравнив с чужим экраном.
 */
export function TimerDisplay({ config, state }: TimerDisplayProps): React.JSX.Element {
  /**
   * Часы держим в состоянии и двигаем только из таймеров.
   *
   * Читать `Date.now()` прямо в рендере нельзя: один и тот же пропс давал бы
   * разный результат при каждом перерисовывании, а React вправе перерисовать
   * компонент когда угодно.
   */
  const [clock, setClock] = useState(() => ({ now: Date.now(), skewMs: 0 }));

  const running = state?.endsAt !== null && state?.endsAt !== undefined;
  const serverNow = state?.serverNow;

  useEffect(() => {
    // Поправка считается один раз на присланное состояние, а не каждую
    // секунду: иначе она дрожала бы вместе с задержкой сети.
    const skewMs = serverNow ? new Date(serverNow).getTime() - Date.now() : 0;
    const apply = (): void => setClock({ now: Date.now(), skewMs });

    // Первый пересчёт через setTimeout(0), а не сразу: синхронный setState
    // внутри эффекта запускает каскад лишних рендеров.
    const immediate = setTimeout(apply, 0);
    const interval = running ? setInterval(apply, 1000) : undefined;

    return () => {
      clearTimeout(immediate);
      if (interval) clearInterval(interval);
    };
  }, [serverNow, running]);

  const remaining = state
    ? timerRemainingSeconds(state, clock.now, clock.skewMs)
    : config.initialSeconds;

  const text = textStyleToCss(config.text);

  return (
    <div
      data-testid="timer-display"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      {config.title ? (
        <div style={{ ...text, fontSize: Math.round(config.text.fontSize * 0.5) }}>
          {config.title}
        </div>
      ) : null}

      <div
        style={{
          ...text,
          fontSize: config.text.fontSize,
          fontWeight: 700,
          // Моноширинные цифры: без них строка дёргается на каждой секунде,
          // потому что единица уже остальных цифр.
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatDuration(remaining, config.showHours)}
      </div>
    </div>
  );
}
