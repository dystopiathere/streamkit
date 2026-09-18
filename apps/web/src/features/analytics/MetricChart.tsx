import type { AnalyticsPoint, AnalyticsRange } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { intlLocale } from '@/lib/locale';

/**
 * Цвета рядов.
 *
 * Подобраны не на глаз: пара проверена валидатором на разделимость при
 * дальтонизме и на контраст относительно фона карточки (#1b1c25). Синий из
 * стандартной палитры пришлось отбросить — рядом с фиолетовым акцентом
 * приложения он даёт ΔE 0.9 для дейтеранопии, то есть для такого зрителя это
 * один и тот же цвет. Зелёный и красный зарезервированы под статусы (суммы
 * донатов, ошибки) и в ряды не идут.
 */
export const SERIES_COLORS = {
  viewers: '#9167ea',
  subscribers: '#c98500',
} as const;

/** Сетка и подписи — рецессивные: данные должны быть заметнее разметки. */
const GRID_COLOR = 'var(--color-border)';
const TEXT_COLOR = 'var(--color-muted)';

export type MetricKind = keyof typeof SERIES_COLORS;

interface MetricChartProps {
  points: AnalyticsPoint[];
  kind: MetricKind;
  /** Заголовок называет ряд — поэтому легенда для одного ряда не нужна. */
  title: string;
  range: AnalyticsRange;
  emptyLabel: string;
  valueLabel: string;
}

/**
 * График одной метрики во времени.
 *
 * Осознанно ОДНА величина на график. Зрители измеряются десятками и сотнями,
 * подписчики — тысячами и десятками тысяч; на общей оси меньшая величина
 * вырождается в прямую по нулю. Вторая ось решала бы это ценой того, что
 * пересечение линий начинает означать ровно ничего, а взгляд читает его как
 * событие. Два графика рядом честнее.
 */
export function MetricChart({
  points,
  kind,
  title,
  range,
  emptyLabel,
  valueLabel,
}: MetricChartProps): React.JSX.Element {
  const color = SERIES_COLORS[kind];
  const hasData = points.some((point) => point[kind] !== null);
  const summary = useChartSummary(points, kind, title);

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
                {axes(range)}
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
                {tooltip(color, valueLabel, range)}
              </AreaChart>
            ) : (
              <LineChart data={points} margin={CHART_MARGIN}>
                {axes(range, false)}
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
                {tooltip(color, valueLabel, range)}
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

const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

function axes(range: AnalyticsRange, fromZero = true): React.JSX.Element {
  return (
    <>
      {/* Только горизонтальные линии: вертикальные ничего не добавляют, когда
          по оси времени и так стоят подписи. */}
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
        width={56}
        // Ось от нуля только там, где заливка до базовой линии этот ноль
        // обещает. Для линии уровня нулевая база вредна: подписчиков тысячи,
        // прирост за неделю — сотни, и на шкале от нуля недельный рост
        // превращается в идеально прямую линию. Ровно это и было видно.
        domain={fromZero ? [0, 'auto'] : ['dataMin', 'dataMax']}
        allowDecimals={false}
        tickFormatter={formatCompact}
      />
    </>
  );
}

function tooltip(color: string, valueLabel: string, range: AnalyticsRange): React.JSX.Element {
  return (
    <Tooltip
      // Перекрестие: по линии без него трудно попасть в нужный момент времени.
      cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }}
      content={({ active, payload }) => {
        const point = active ? payload?.[0] : undefined;
        if (!point || point.value === null || point.value === undefined) return null;

        return (
          <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
            <p className="text-muted">{formatFull(String(point.payload.at), range)}</p>
            <p className="mt-1 flex items-center gap-2">
              {/* Цвет несёт метка рядом с текстом, а не сам текст: цветной
                  текст на тёмном фоне читается хуже обычного. */}
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-muted">{valueLabel}</span>
              <span className="font-medium tabular-nums">
                {new Intl.NumberFormat(intlLocale()).format(Number(point.value))}
              </span>
            </p>
          </div>
        );
      }}
    />
  );
}

/**
 * Подпись оси времени зависит от ДИАПАЗОНА, а не от размера корзины.
 *
 * Неделя прореживается по часам — и подпись «09:00» повторялась на оси шесть
 * раз подряд, для шести разных дней. Формально верно, читать невозможно: ось
 * выглядела сломанной.
 */
function formatTick(value: string, range: AnalyticsRange): string {
  const date = new Date(value);
  return range === '24h'
    ? date.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
}

/** В подсказке точность полная: там место есть, и момент нужен точный. */
function formatFull(value: string, range: AnalyticsRange): string {
  const date = new Date(value);
  return range === '30d'
    ? date.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long' })
    : date.toLocaleString(intlLocale(), {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/**
 * Подпись деления оси.
 *
 * Компактная запись включается только на больших числах. На подписчиках её
 * пришлось убрать: шкала там подогнана под данные, соседние деления
 * отличаются на десятки, и «4325» с «4380» превращались в одинаковое
 * «4,3 тыс.» — две разные линии сетки получали одну и ту же подпись.
 */
function formatCompact(value: number): string {
  if (Math.abs(value) < 100_000) {
    return new Intl.NumberFormat(intlLocale()).format(Math.round(value));
  }
  return new Intl.NumberFormat(intlLocale(), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
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
  const format = (value: number): string => new Intl.NumberFormat(intlLocale()).format(value);
  return t('analytics.chartSummary', {
    title,
    min: format(Math.min(...values)),
    max: format(Math.max(...values)),
    last: format(values[values.length - 1]!),
  });
}
