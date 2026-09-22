/**
 * Безопасные зоны в процентах от края кадра: внешняя (действие) и внутренняя
 * (титры) — те же, что пунктиром на разметке ниже.
 */
export const SAFE_AREA = { action: 5, title: 10 } as const;

/**
 * Разметка испытательной таблицы в кадре редактора, и она рабочая: пунктир —
 * безопасные зоны (всё важное держат внутри внутренней, край кадра OBS и плеер
 * площадки съедают поля), крест и круг — центр кадра.
 *
 * Общая для раскладки элементов и мест гостей: одинаковая сетка в двух
 * редакторах — одинаковые ориентиры.
 */
export function FrameGuides(): React.JSX.Element {
  return (
    <>
      <svg
        aria-hidden="true"
        viewBox="0 0 160 90"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <rect
          x="8"
          y="4.5"
          width="144"
          height="81"
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth="0.35"
          strokeDasharray="2 1.5"
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x="16"
          y="9"
          width="128"
          height="72"
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth="0.35"
          strokeDasharray="0.6 1.4"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="80"
          y1="0"
          x2="80"
          y2="90"
          stroke="var(--color-border)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="0"
          y1="45"
          x2="160"
          y2="45"
          stroke="var(--color-border)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 aspect-square h-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border"
      />
    </>
  );
}
