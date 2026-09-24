import type { AnalyticsRange } from '@streamkit/contracts';
import { CartesianGrid, XAxis, YAxis } from 'recharts';
import { intlLocale } from '@/lib/locale';

/**
 * Цвета величин аналитики. Цвет следует за величиной, а не за графиком:
 * донаты бирюзовые и на графике по дням, и на графике связи с эфирами.
 *
 * Четвёрка проверена валидатором dataviz на поверхности карточки (#252522,
 * тёмная тема): все пары, а не только соседние, — ΔE не ниже 9.9 при
 * дейтеранопии и 16 обычным зрением, контраст к фону не ниже 3:1. Зелёный и
 * красный статусов в ряды не идут; розовый «эфира» — не красный ошибки: он
 * светлее и сдвинут к пурпуру, и рядом с ним всегда подпись.
 */
export const SERIES_COLORS = {
  viewers: '#9167ea',
  audience: '#c98500',
  donations: '#2b9fb3',
  live: '#e0607a',
} as const;
export type SeriesColor = keyof typeof SERIES_COLORS;

/** Сетка и подписи — рецессивные: данные должны быть заметнее разметки. */
export const GRID_COLOR = 'var(--color-border)';
export const TEXT_COLOR = 'var(--color-muted)';
export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

/**
 * Подпись оси времени зависит от ДИАПАЗОНА, а не от размера корзины.
 *
 * Неделя прореживается по часам — и подпись «09:00» повторялась на оси шесть
 * раз подряд, для шести разных дней. Формально верно, читать невозможно: ось
 * выглядела сломанной.
 */
export function formatTick(value: string, range: AnalyticsRange): string {
  const date = new Date(value);
  return range === '24h'
    ? date.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
}

/** В подсказке точность полная: у суточной корзины — дата, у часовой — и время. */
export function formatFull(value: string, bucket: 'hour' | 'day'): string {
  const date = new Date(value);
  return bucket === 'day'
    ? date.toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'long' })
    : date.toLocaleString(intlLocale(), {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(intlLocale()).format(value);
}

/**
 * Подпись деления оси.
 *
 * Компактная запись включается только на больших числах. На подписчиках её
 * пришлось убрать: шкала там подогнана под данные, соседние деления
 * отличаются на десятки, и «4325» с «4380» превращались в одинаковое
 * «4,3 тыс.» — две разные линии сетки получали одну и ту же подпись.
 */
export function formatCompact(value: number): string {
  if (Math.abs(value) < 100_000) {
    return new Intl.NumberFormat(intlLocale()).format(Math.round(value));
  }
  return new Intl.NumberFormat(intlLocale(), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Оси графика во времени. Только горизонтальные линии сетки: вертикальные
 * ничего не добавляют, когда по оси времени и так стоят подписи.
 */
export function timeAxes({
  range,
  fromZero = true,
  tickFormatter = formatCompact,
  yWidth = 56,
}: {
  range: AnalyticsRange;
  fromZero?: boolean;
  tickFormatter?: (value: number) => string;
  yWidth?: number;
}): React.JSX.Element {
  return (
    <>
      <CartesianGrid stroke={GRID_COLOR} strokeOpacity={0.5} vertical={false} />
      <XAxis
        dataKey="at"
        tickFormatter={(value: string) => formatTick(value, range)}
        stroke={GRID_COLOR}
        tick={{ fill: TEXT_COLOR, fontSize: 11 }}
        tickLine={false}
        minTickGap={32}
      />
      <YAxis
        stroke={GRID_COLOR}
        tick={{ fill: TEXT_COLOR, fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        width={yWidth}
        // Ось от нуля только там, где заливка или столбик до базовой линии этот
        // ноль обещают. Для линии уровня нулевая база вредна: подписчиков
        // тысячи, прирост за неделю — сотни, и на шкале от нуля недельный рост
        // превращается в идеально прямую линию.
        domain={fromZero ? [0, 'auto'] : ['dataMin', 'dataMax']}
        allowDecimals={false}
        tickFormatter={tickFormatter}
      />
    </>
  );
}

/**
 * Подсказка графика: момент и одно значение с меткой цвета рядом.
 * Цвет несёт метка, а не текст: цветной текст на тёмном фоне читается хуже.
 */
export function ChartTooltipBox({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ color: string; label: string; value: string }>;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="mt-1 flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: row.color }}
          />
          <span className="text-muted">{row.label}</span>
          <span className="font-medium tabular-nums">{row.value}</span>
        </p>
      ))}
    </div>
  );
}
