import type { AnalyticsPoint, AnalyticsRange } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  CHART_MARGIN,
  ChartTooltipBox,
  formatFull,
  formatNumber,
  GRID_COLOR,
  SERIES_COLORS,
  timeAxes,
} from './chart-kit';

/** Какую величину ряда рисует график и каким цветом. */
export type MetricKind = 'viewers' | 'followers' | 'subscribers';

interface MetricChartProps {
  points: AnalyticsPoint[];
  kind: MetricKind;
  /** Заголовок называет ряд — поэтому легенда для одного ряда не нужна. */
  title: string;
  range: AnalyticsRange;
  bucket: 'hour' | 'day';
  emptyLabel: string;
  valueLabel: string;
}

/**
 * График одной метрики канала во времени.
 *
 * Осознанно ОДНА величина на график. Зрители измеряются десятками и сотнями,
 * подписчики — тысячами и десятками тысяч; на общей оси меньшая величина
 * вырождается в прямую по нулю. Вторая ось решала бы это ценой того, что
 * пересечение линий начинает означать ровно ничего, а взгляд читает его как
 * событие. Два графика рядом честнее.
 *
 * Зрители — заливка до нуля (их «сколько»), аудитория — линия уровня (её
 * «как меняется»); цвет аудитории один у фолловеров Twitch и подписчиков
 * YouTube: это одна и та же величина под разными названиями.
 */
export function MetricChart({
  points,
  kind,
  title,
  range,
  bucket,
  emptyLabel,
  valueLabel,
}: MetricChartProps): React.JSX.Element {
  const color = kind === 'viewers' ? SERIES_COLORS.viewers : SERIES_COLORS.audience;
  const hasData = points.some((point) => point[kind] !== null);
  const summary = useChartSummary(points, kind, title);
  const tooltip = (
    <Tooltip
      // Перекрестие: по линии без него трудно попасть в нужный момент времени.
      cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }}
      content={({ active, payload }) => {
        const point = active ? payload?.[0] : undefined;
        if (!point || point.value === null || point.value === undefined) return null;
        return (
          <ChartTooltipBox
            title={formatFull(String(point.payload.at), bucket)}
            rows={[{ color, label: valueLabel, value: formatNumber(Number(point.value)) }]}
          />
        );
      }}
    />
  );

  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-sm font-medium">{title}</figcaption>

      {hasData ? (
        // Сам график — картинка для мыши: подсказка появляется только при
        // наведении. Скринридер получает те же выводы текстом.
        <div className="h-48 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'viewers' ? (
              <AreaChart data={points} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id={`fill-${kind}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {timeAxes({ range })}
                <Area
                  type="monotone"
                  dataKey={kind}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#fill-${kind})`}
                  // Точка на каждом значении превращает линию в пунктир из
                  // кружков; показываем только ту, на которую наведён курсор.
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {tooltip}
              </AreaChart>
            ) : (
              <LineChart data={points} margin={CHART_MARGIN}>
                {timeAxes({ range, fromZero: false })}
                <Line
                  type="monotone"
                  dataKey={kind}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
                  connectNulls
                  isAnimationActive={false}
                />
                {tooltip}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="flex h-48 items-center justify-center text-sm text-muted">{emptyLabel}</p>
      )}
      {hasData ? <p className="sr-only">{summary}</p> : null}
    </figure>
  );
}

/**
 * Выводы графика одной фразой — для тех, кто его не видит.
 *
 * Разброс и последнее значение — то, что зрячий считывает с линии за секунду;
 * перечислять все точки было бы честно, но слушать невозможно.
 */
function useChartSummary(points: AnalyticsPoint[], kind: MetricKind, title: string): string {
  const { t } = useTranslation();
  const values = points
    .map((point) => point[kind])
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return '';
  return t('analytics.chartSummary', {
    title,
    min: formatNumber(Math.min(...values)),
    max: formatNumber(Math.max(...values)),
    last: formatNumber(values[values.length - 1]!),
  });
}
