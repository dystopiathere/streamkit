import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface SeriesPoint {
  /** Начало корзины, ISO-строка. */
  at: string;
  value: number | null;
}

export interface TimeSeriesChartProps {
  title: string;
  points: SeriesPoint[];
  /**
   * Цвет ряда. Палитру выбирает приложение и проверяет её на разделимость при
   * дальтонизме: зелёный и красный зарезервированы под статусы.
   */
  color: string;
  /**
   * `area` — уровень (сколько активно), `bar` — количество за корзину (сколько
   * произошло). Столбцы честнее для счётчиков: линия между двумя днями
   * придумывает значения, которых не было.
   */
  variant?: 'area' | 'bar';
  valueLabel: string;
  emptyLabel: string;
  /** Текст для скринридера: выводы графика одной фразой. */
  summary: string;
  formatTick: (at: string) => string;
  formatTooltipAt: (at: string) => string;
  formatValue?: (value: number) => string;
  /** Ось чисел: деньги показываются в рублях, а считаются в копейках. */
  formatAxis?: (value: number) => string;
  height?: number;
}

const GRID_COLOR = 'var(--color-border)';
const TEXT_COLOR = 'var(--color-muted)';
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };
const numberFormat = new Intl.NumberFormat('ru-RU');
const defaultFormat = (value: number): string => numberFormat.format(value);

/**
 * График одной величины во времени.
 *
 * Одна величина на график — по той же причине, что и в аналитике дашборда:
 * вторая ось делает пересечение линий событием, которого нет.
 */
export function TimeSeriesChart({
  title,
  points,
  color,
  variant = 'area',
  valueLabel,
  emptyLabel,
  summary,
  formatTick,
  formatTooltipAt,
  formatValue = defaultFormat,
  formatAxis = compactAxis,
  height = 192,
}: TimeSeriesChartProps): React.JSX.Element {
  const hasData = points.some((point) => point.value !== null && point.value !== 0);
  const gradientId = `fill-${title.replace(/[^\p{L}\p{N}]+/gu, '-')}`;

  const axes = (
    <>
      <CartesianGrid stroke={GRID_COLOR} strokeOpacity={0.5} vertical={false} />
      <XAxis
        dataKey="at"
        tickFormatter={formatTick}
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
        width={64}
        domain={[0, 'auto']}
        allowDecimals={false}
        tickFormatter={formatAxis}
      />
      <Tooltip
        cursor={variant === 'bar' ? { fill: GRID_COLOR, fillOpacity: 0.3 } : { stroke: GRID_COLOR }}
        content={({ active, payload }) => {
          const point = active ? payload?.[0] : undefined;
          if (!point || point.value === null || point.value === undefined) return null;
          return (
            <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
              <p className="text-muted">{formatTooltipAt(String(point.payload.at))}</p>
              <p className="mt-1 flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-muted">{valueLabel}</span>
                <span className="font-medium tabular-nums">{formatValue(Number(point.value))}</span>
              </p>
            </div>
          );
        }}
      />
    </>
  );

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-sm font-medium">{title}</figcaption>
      {hasData ? (
        <>
          <div className="w-full" style={{ height }} aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              {variant === 'bar' ? (
                <BarChart data={points} margin={CHART_MARGIN}>
                  {axes}
                  <Bar
                    dataKey="value"
                    fill={color}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                </BarChart>
              ) : (
                <AreaChart data={points} margin={CHART_MARGIN}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  {axes}
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={color}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
          <p className="sr-only">{summary}</p>
        </>
      ) : (
        <p className="flex items-center justify-center text-sm text-muted" style={{ height }}>
          {emptyLabel}
        </p>
      )}
    </figure>
  );
}

function compactAxis(value: number): string {
  if (Math.abs(value) < 100_000) return numberFormat.format(Math.round(value));
  return new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/** Сумма, разброс и последнее значение ряда — основа текстовой сводки графика. */
export function seriesSummary(
  points: SeriesPoint[],
): { total: number; min: number; max: number; last: number } | null {
  const values = points
    .map((point) => point.value)
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return null;
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    min: Math.min(...values),
    max: Math.max(...values),
    last: values[values.length - 1]!,
  };
}
