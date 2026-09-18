import { useEffect, useState } from 'react';

/** «1:02:03» — часы, минуты и секунды эфира. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Сколько идёт эфир.
 *
 * Время — в состоянии и двигается таймером: `Date.now()` в теле компонента
 * сделал бы рендер нечистым (грабли в CLAUDE.md). Время начала — по часам
 * площадки, расхождение часов стримера с ними съест разве что секунду.
 */
export function StreamClock({ startedAt }: { startedAt: string }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <time dateTime={startedAt} className="tabular-nums">
      {formatDuration(now - Date.parse(startedAt))}
    </time>
  );
}
