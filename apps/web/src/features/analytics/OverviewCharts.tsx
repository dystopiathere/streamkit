import {
  type AnalyticsOverview,
  correlationStrength,
  MIN_CORRELATION_SAMPLES,
  type OverviewBucket,
  spearman,
} from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@streamkit/app-kit';
import { formatMoney, intlLocale } from '@/lib/locale';
import {
  CHART_MARGIN,
  ChartTooltipBox,
  formatFull,
  formatNumber,
  GRID_COLOR,
  SERIES_COLORS,
  TEXT_COLOR,
  timeAxes,
} from './chart-kit';
import { formatDuration, formatGain, money } from './OverviewSummary';

/** Все графики времени двигают перекрестие вместе: один день — одна вертикаль. */
const SYNC_ID = 'analytics-timeline';

/** Сумма на оси — коротко: «12 тыс. ₽». В подсказке и таблице — полностью. */
function moneyTick(currency: AnalyticsOverview['currency']) {
  return (amountMinor: number): string =>
    new Intl.NumberFormat(intlLocale(), {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amountMinor / 100);
}

type TimelineMetric = 'donations' | 'live' | 'audience';

/**
 * Донаты, часы в эфире и прирост аудитории по дням — три графика друг под
 * другом на общей оси времени.
 *
 * Три графика, а не один с тремя шкалами: рубли, часы и люди на одной оси
 * дали бы совпадения, которых нет, — ровно то, что здесь хотят увидеть
 * по-настоящему. Общая ось времени и общее перекрестие дают сравнить дни
 * взглядом сверху вниз: был ли эфир в день всплеска донатов.
 */
export function TimelineCharts({ overview }: { overview: AnalyticsOverview }): React.JSX.Element {
  const { t } = useTranslation();
  const data = overview.buckets.map((bucket) => ({
    ...bucket,
    // Часы — дробью только для высоты столбика; подписи — минутами словами.
    liveHours: bucket.liveMinutes / 60,
  }));
  const hasAudience = overview.buckets.some((bucket) => bucket.audienceGain !== null);

  return (
    <Card className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-medium">{t('analytics.timeline.title')}</h2>
        <p className="text-sm text-muted">{t('analytics.timeline.description')}</p>
      </div>
      <TimelineBar
        metric="donations"
        data={data}
        overview={overview}
        title={t('analytics.timeline.donations')}
        dataKey="donationsMinor"
        tickFormatter={moneyTick(overview.currency)}
        format={(bucket) => money(bucket.donationsMinor, overview.currency)}
      />
      <TimelineBar
        metric="live"
        data={data}
        overview={overview}
        title={t('analytics.timeline.live')}
        dataKey="liveHours"
        tickFormatter={(hours) => formatNumber(Math.round(hours))}
        format={(bucket) => formatDuration(t, bucket.liveMinutes)}
      />
      {hasAudience ? (
        <TimelineBar
          metric="audience"
          data={data}
          overview={overview}
          title={t('analytics.timeline.audience')}
          dataKey="audienceGain"
          tickFormatter={(value) => formatNumber(value)}
          format={(bucket) =>
            bucket.audienceGain === null ? t('analytics.noValue') : formatGain(bucket.audienceGain)
          }
        />
      ) : null}
      <TimelineTable overview={overview} />
    </Card>
  );
}

const METRIC_COLOR: Record<TimelineMetric, string> = {
  donations: SERIES_COLORS.donations,
  live: SERIES_COLORS.live,
  audience: SERIES_COLORS.audience,
};

function TimelineBar({
  metric,
  data,
  overview,
  title,
  dataKey,
  tickFormatter,
  format,
}: {
  metric: TimelineMetric;
  data: Array<OverviewBucket & { liveHours: number }>;
  overview: AnalyticsOverview;
  title: string;
  dataKey: 'donationsMinor' | 'liveHours' | 'audienceGain';
  tickFormatter: (value: number) => string;
  format: (bucket: OverviewBucket) => string;
}): React.JSX.Element {
  const color = METRIC_COLOR[metric];
  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <div className="h-36 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={CHART_MARGIN} syncId={SYNC_ID} barCategoryGap={2}>
            {timeAxes({ range: overview.range, tickFormatter, yWidth: 64 })}
            <Bar
              dataKey={dataKey}
              fill={color}
              maxBarSize={28}
              // Скруглён только конец данных; у прироста столбик бывает и
              // вниз, и скругление у нуля читалось бы как его конец.
              radius={metric === 'audience' ? 0 : [4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Tooltip
              cursor={{ fill: 'var(--color-surface-hover)' }}
              content={({ active, payload }) => {
                const bucket = active
                  ? (payload?.[0]?.payload as OverviewBucket | undefined)
                  : undefined;
                if (!bucket) return null;
                return (
                  <ChartTooltipBox
                    title={formatFull(bucket.at, overview.bucket)}
                    rows={[{ color, label: title, value: format(bucket) }]}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Табличный двойник графиков по дням — для скринридера и для точных чисел. */
function TimelineTable({ overview }: { overview: AnalyticsOverview }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <details className="text-sm">
      <summary className="text-muted hover:text-fg">{t('analytics.timeline.table')}</summary>
      <div className="mt-3 max-h-80 overflow-y-auto">
        <table className="w-full">
          <caption className="sr-only">{t('analytics.timeline.title')}</caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-1 font-normal">
                {t('analytics.timeline.period')}
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                {t('analytics.stats.donations')}
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                {t('analytics.timeline.live')}
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                {t('analytics.timeline.audience')}
              </th>
            </tr>
          </thead>
          <tbody>
            {overview.buckets.map((bucket) => (
              <tr key={bucket.at} className="border-t border-border">
                <th scope="row" className="py-1.5 text-left font-normal">
                  {formatFull(bucket.at, overview.bucket)}
                </th>
                <td className="py-1.5 text-right tabular-nums">
                  {money(bucket.donationsMinor, overview.currency)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {bucket.liveMinutes > 0 ? formatDuration(t, bucket.liveMinutes) : '0'}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {bucket.audienceGain === null
                    ? t('analytics.noValue')
                    : formatGain(bucket.audienceGain)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Связь длительности эфира с донатами или приростом — точка на эфир.
 *
 * Под графиком — коэффициент словами: «умеренная прямая связь». Точки без
 * слов читают как угодно, а коэффициент без точек не видно, на чём он стоит.
 * Меньше трёх эфиров — связи не называем вовсе.
 */
export function CorrelationChart({
  overview,
  measure,
}: {
  overview: AnalyticsOverview;
  measure: 'donations' | 'audience';
}): React.JSX.Element {
  const { t } = useTranslation();
  const streams = overview.streams.filter(
    (stream) => measure === 'donations' || stream.audienceGain !== null,
  );
  const points = streams.map((stream) => ({
    hours: stream.minutes / 60,
    value: measure === 'donations' ? stream.donationsMinor : stream.audienceGain!,
    stream,
  }));
  const coefficient = spearman(
    streams.map((stream) => stream.minutes),
    streams.map((stream) =>
      measure === 'donations' ? stream.donationsMinor : stream.audienceGain!,
    ),
  );
  const color = measure === 'donations' ? SERIES_COLORS.donations : SERIES_COLORS.audience;
  const title = t(`analytics.correlation.${measure}.title`);
  const valueLabel = t(`analytics.correlation.${measure}.axis`);
  const formatValue = (value: number): string =>
    measure === 'donations' ? money(value, overview.currency) : formatGain(value);

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">{title}</h2>
      {points.length === 0 ? (
        <p className="flex h-48 items-center justify-center text-sm text-muted">
          {t('analytics.correlation.noStreams')}
        </p>
      ) : (
        <div className="h-56 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ ...CHART_MARGIN, bottom: 16 }}>
              <CartesianGrid stroke={GRID_COLOR} strokeOpacity={0.5} />
              <XAxis
                type="number"
                dataKey="hours"
                name={t('analytics.correlation.hours')}
                // Целые часы на оси: «1,9» и «2,9» читаются хуже, чем 2 и 3.
                domain={[0, (max: number) => Math.max(1, Math.ceil(max))]}
                allowDecimals={false}
                stroke={GRID_COLOR}
                tick={{ fill: TEXT_COLOR, fontSize: 11 }}
                tickLine={false}
                tickFormatter={(hours: number) =>
                  new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(hours)
                }
                label={{
                  value: t('analytics.correlation.hours'),
                  position: 'insideBottom',
                  offset: -12,
                  fill: TEXT_COLOR,
                  fontSize: 11,
                }}
              />
              <YAxis
                type="number"
                dataKey="value"
                stroke={GRID_COLOR}
                tick={{ fill: TEXT_COLOR, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={
                  measure === 'donations' ? moneyTick(overview.currency) : formatNumber
                }
              />
              <Scatter
                data={points}
                fill={color}
                // Кольцо цвета поверхности отделяет наложившиеся точки.
                stroke="var(--color-surface)"
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Tooltip
                cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const point = active
                    ? (payload?.[0]?.payload as (typeof points)[number] | undefined)
                    : undefined;
                  if (!point) return null;
                  return (
                    <ChartTooltipBox
                      title={new Date(point.stream.startedAt).toLocaleString(intlLocale(), {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      rows={[
                        {
                          color,
                          label: t('analytics.streams.duration'),
                          value: formatDuration(t, point.stream.minutes),
                        },
                        { color, label: valueLabel, value: formatValue(point.value) },
                      ]}
                    />
                  );
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-sm">
        <CorrelationVerdict coefficient={coefficient} count={streams.length} measure={measure} />
      </p>
    </Card>
  );
}

function CorrelationVerdict({
  coefficient,
  count,
  measure,
}: {
  coefficient: number | null;
  count: number;
  measure: 'donations' | 'audience';
}): React.JSX.Element {
  const { t } = useTranslation();
  if (coefficient === null) {
    return (
      <span className="text-muted">
        {count < MIN_CORRELATION_SAMPLES
          ? t('analytics.correlation.tooFew', { min: MIN_CORRELATION_SAMPLES })
          : t('analytics.correlation.constant')}
      </span>
    );
  }
  const strength = correlationStrength(coefficient);
  const value = new Intl.NumberFormat(intlLocale(), {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(coefficient);
  return (
    <>
      {strength === 'none'
        ? t(`analytics.correlation.${measure}.none`)
        : t(`analytics.correlation.${measure}.${coefficient > 0 ? 'positive' : 'negative'}`, {
            strength: t(`analytics.correlation.strength.${strength}`),
          })}{' '}
      <span className="text-muted">{t('analytics.correlation.coefficient', { value, count })}</span>
    </>
  );
}

/** Понедельник первым: так неделю читают в РФ, и так её отдаёт `ISODOW`. */
function weekdayNames(): string[] {
  const monday = new Date(Date.UTC(2024, 0, 1));
  return Array.from({ length: 7 }, (_, index) =>
    new Date(monday.getTime() + index * 86_400_000).toLocaleDateString(intlLocale(), {
      weekday: 'short',
      timeZone: 'UTC',
    }),
  );
}

/**
 * Когда донатят: день недели × час, по местному времени.
 *
 * Один оттенок от поверхности к бирюзе донатов — это величина, а не категории.
 * Пустая клетка — цвет поверхности, чтобы «ничего» не спорило с «немного».
 * Над картой — лучший час словами: его и ищут, а цвет только подтверждает.
 */
export function DonationHeatmap({ overview }: { overview: AnalyticsOverview }): React.JSX.Element {
  const { t } = useTranslation();
  const names = weekdayNames();
  const cells = new Map(overview.heatmap.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const max = Math.max(0, ...overview.heatmap.map((cell) => cell.amountMinor));
  const best = [...overview.heatmap].sort((a, b) => b.amountMinor - a.amountMinor)[0];
  const hour = (value: number): string => `${String(value).padStart(2, '0')}:00`;

  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-medium">{t('analytics.heatmap.title')}</h2>
        <p className="text-sm text-muted">{t('analytics.heatmap.description')}</p>
      </div>
      {best ? (
        <p className="text-sm">
          {t('analytics.heatmap.best', {
            day: names[best.weekday - 1],
            from: hour(best.hour),
            to: hour((best.hour + 1) % 24),
            amount: formatMoney({ amountMinor: best.amountMinor, currency: overview.currency }),
            count: best.count,
          })}
        </p>
      ) : (
        <p className="text-sm text-muted">{t('analytics.heatmap.empty')}</p>
      )}

      <div className="overflow-x-auto overflow-y-hidden" aria-hidden="true">
        <div
          className="grid min-w-[36rem] gap-0.5 text-[10px] text-muted"
          style={{ gridTemplateColumns: '2.5rem repeat(24, minmax(0, 1fr))' }}
        >
          <span />
          {Array.from({ length: 24 }, (_, index) => (
            <span key={index} className="text-center">
              {index % 3 === 0 ? index : ''}
            </span>
          ))}
          {names.map((name, dayIndex) => (
            <HeatRow
              key={name}
              name={name}
              cells={Array.from({ length: 24 }, (_, index) =>
                cells.get(`${dayIndex + 1}:${index}`),
              )}
              max={max}
              currency={overview.currency}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted" aria-hidden="true">
        <span>{t('analytics.heatmap.less')}</span>
        <span
          className="h-2 w-24 rounded-sm"
          style={{
            background: `linear-gradient(to right, var(--color-surface-hover), ${SERIES_COLORS.donations})`,
          }}
        />
        <span>{t('analytics.heatmap.more')}</span>
      </div>

      <details className="text-sm">
        <summary className="text-muted hover:text-fg">{t('analytics.heatmap.table')}</summary>
        <table className="mt-3 w-full">
          <caption className="sr-only">{t('analytics.heatmap.title')}</caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-1 font-normal">
                {t('analytics.heatmap.slot')}
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                {t('analytics.stats.donations')}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...overview.heatmap]
              .sort((a, b) => b.amountMinor - a.amountMinor)
              .map((cell) => (
                <tr key={`${cell.weekday}:${cell.hour}`} className="border-t border-border">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {names[cell.weekday - 1]}, {hour(cell.hour)}–{hour((cell.hour + 1) % 24)}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">
                    {money(cell.amountMinor, overview.currency)} ·{' '}
                    {t('analytics.donationsCount', { count: cell.count })}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

function HeatRow({
  name,
  cells,
  max,
  currency,
}: {
  name: string;
  cells: Array<AnalyticsOverview['heatmap'][number] | undefined>;
  max: number;
  currency: AnalyticsOverview['currency'];
}): React.JSX.Element {
  return (
    <>
      <span className="self-center pr-1 text-right">{name}</span>
      {cells.map((cell, index) => {
        // Доля от максимума — только для цвета клетки, суммы остаются целыми.
        // Смешение в oklab, а не oklch: в oklch тон шёл бы от бирюзы к тёплому
        // серому через зелёный, и слабые клетки выглядели бы оливковыми.
        const share = cell && max > 0 ? cell.amountMinor / max : 0;
        return (
          <span
            key={index}
            title={cell ? `${name} ${index}:00 — ${money(cell.amountMinor, currency)}` : undefined}
            className="aspect-square rounded-[2px]"
            style={{
              backgroundColor: cell
                ? `color-mix(in oklab, ${SERIES_COLORS.donations} ${Math.round(20 + share * 80)}%, var(--color-surface-hover))`
                : 'var(--color-surface-hover)',
            }}
          />
        );
      })}
    </>
  );
}

/**
 * Что происходило на канале, кроме донатов: фолловы, подписки, рейды…
 *
 * Столбики нейтральные: типы событий здесь различает подпись, а цвет занят
 * величинами графиков выше.
 */
export function EventMix({ overview }: { overview: AnalyticsOverview }): React.JSX.Element {
  const { t } = useTranslation();
  const max = Math.max(1, ...overview.eventCounts.map((row) => row.count));

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">{t('analytics.events.title')}</h2>
      {overview.eventCounts.length === 0 ? (
        <p className="text-sm text-muted">{t('analytics.events.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {overview.eventCounts.map((row) => (
            <li
              key={row.type}
              className="grid grid-cols-[9rem_minmax(0,1fr)_4rem] items-center gap-3 text-sm"
            >
              <span className="truncate">{t(`events.type.${row.type}`)}</span>
              <span className="h-2 rounded-sm bg-surface-hover" aria-hidden="true">
                <span
                  className="block h-2 rounded-sm bg-muted"
                  style={{ width: `${Math.max(2, Math.round((row.count / max) * 100))}%` }}
                />
              </span>
              <span className="text-right tabular-nums">{formatNumber(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
