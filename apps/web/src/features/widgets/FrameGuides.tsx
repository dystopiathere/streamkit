import { GRID_STEP } from './grid';

/**
 * Безопасные зоны в процентах от края кадра: внешняя (действие) и внутренняя
 * (титры) — те же, что пунктиром на разметке ниже.
 */
export const SAFE_AREA = { action: 5, title: 10 } as const;

/**
 * Разметка испытательной таблицы в кадре редактора, и она рабочая: пунктир —
 * безопасные зоны (всё важное держат внутри внутренней, край кадра OBS и плеер
 * площадки съедают поля), крест и круг — центр кадра, клетки — сетка
 * примагничивания (`GRID_STEP`).
 *
 * Общая для раскладки элементов и мест гостей: одинаковая сетка в двух
 * редакторах — одинаковые ориентиры.
 */
export function FrameGuides({
  /** Элемент прямо сейчас магнитится по сетке — клетки видны яснее. */
  snapping = false,
}: {
  snapping?: boolean;
} = {}): React.JSX.Element {
  // Линии в координатах viewBox: шаг сетки — доля кадра, а не пиксели.
  const cells = Math.round(100 / GRID_STEP);
  const lines = Array.from({ length: cells - 1 }, (_, index) => (index + 1) / cells);
  return (
    <>
      <svg
        aria-hidden="true"
        viewBox="0 0 160 90"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {/* Сетка — под остальной разметкой и бледнее её: она ориентир, а не
            рамка кадра. Цвет — `border-strong`, приглушённый прозрачностью:
            обычная рамка на клетчатой подложке не читается вовсе, проверено
            глазами.

            Пока держат Shift, сетка становится жёлтой — цветом того, что
            происходит прямо сейчас. Серую от клетчатой подложки (её клетки
            частые и заметные) глаз не отличает, и выходит, что элемент
            прилипает «не к той сетке», которую видно. */}
        <g
          stroke={snapping ? 'var(--color-accent)' : 'var(--color-border-strong)'}
          strokeWidth={snapping ? 0.6 : 0.5}
          vectorEffect="non-scaling-stroke"
          opacity={snapping ? 1 : 0.8}
        >
          {lines.map((share) => (
            <line key={`v${share}`} x1={share * 160} y1="0" x2={share * 160} y2="90" />
          ))}
          {lines.map((share) => (
            <line key={`h${share}`} x1="0" y1={share * 90} x2="160" y2={share * 90} />
          ))}
        </g>
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
