import { Button, Card, cn, DataTable, NewTabHint, StatusPill } from '@streamkit/app-kit';
import { type SeriesPoint, seriesSummary, TimeSeriesChart } from '@streamkit/app-kit/chart';
import {
  ADMIN_STATS_RANGES,
  type AdminStats,
  type AdminStatsRange,
  type Currency,
  formatMoney,
} from '@streamkit/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, Loading, PageHeader, Status, useAdminTitle } from '@/components/shared';
import { STATS_URL } from '@/lib/config';
import { formatDateTime, formatMoneyList, formatNumber } from '@/lib/format';
import { useStats } from '@/lib/queries';

/**
 * Цвета рядов — те же, что в аналитике дашборда, проверены валидатором на
 * тёмной карточке: количество — фиолетовый, деньги — янтарный. Каждый график
 * несёт одну величину, так что цвет здесь не различает ряды, а связывает
 * однородные графики между собой.
 */
const COUNT_COLOR = '#9167ea';
const MONEY_COLOR = '#c98500';

export function OverviewPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [range, setRange] = useState<AdminStatsRange>('30d');
  const stats = useStats(range);
  useAdminTitle(t('overview.title'));

  return (
    <>
      <PageHeader title={t('overview.title')}>
        <div role="group" aria-label={t('overview.rangeLabel')} className="flex gap-1">
          {ADMIN_STATS_RANGES.map((value) => (
            <Button
              key={value}
              variant={value === range ? 'primary' : 'secondary'}
              aria-pressed={value === range}
              onClick={() => setRange(value)}
            >
              {t(`overview.range.${value}`)}
            </Button>
          ))}
        </div>
      </PageHeader>

      {stats.isPending ? <Loading /> : null}
      {stats.isError ? <ErrorState onRetry={() => void stats.refetch()} /> : null}
      {stats.data ? <Overview stats={stats.data} /> : null}
    </>
  );
}

function Overview({ stats }: { stats: AdminStats }): React.JSX.Element {
  const { t } = useTranslation();
  const problems = stats.channels
    .filter((row) => row.syncState !== 'ok')
    .reduce((sum, row) => sum + row.count, 0);
  const channelsTotal = stats.channels.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="flex flex-col gap-8">
      <p className="-mt-4 text-xs text-muted">
        {t('overview.generatedAt', { at: formatDateTime(stats.generatedAt) })}
      </p>

      <section aria-labelledby="kpi" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <h2 id="kpi" className="sr-only">
          {t('overview.kpi')}
        </h2>
        <Tile
          label={t('overview.users')}
          value={formatNumber(stats.users.total)}
          hint={t('overview.usersHint', { suspended: stats.users.suspended })}
        />
        <Tile
          label={t('overview.active')}
          value={formatNumber(stats.users.active7d)}
          hint={t('overview.activeHint', { count: stats.users.active30d })}
        />
        <Tile
          label={t('overview.subscriptions')}
          value={formatNumber(stats.subscriptions.activeMonth + stats.subscriptions.activeYear)}
          hint={t('overview.subscriptionsHint', {
            month: stats.subscriptions.activeMonth,
            year: stats.subscriptions.activeYear,
            grace: stats.subscriptions.grace,
          })}
        />
        <Tile
          label={t('overview.mrr')}
          value={formatMoneyList(stats.subscriptions.mrr)}
          hint={t('overview.mrrHint', {
            ending: stats.subscriptions.endingWithoutRenewal,
            failures: stats.subscriptions.renewalFailures,
          })}
          attention={stats.subscriptions.renewalFailures > 0}
        />
        <Tile
          label={t('overview.liveOverlays')}
          value={formatNumber(stats.liveOverlays)}
          hint={t('overview.liveOverlaysHint')}
        />
        <Tile
          label={t('overview.channelProblems')}
          value={formatNumber(problems)}
          hint={t('overview.channelProblemsHint', { total: channelsTotal })}
          attention={problems > 0}
        />
      </section>

      <section aria-labelledby="charts">
        <h2 id="charts" className="mb-3 text-lg font-semibold">
          {t('overview.charts')}
        </h2>
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard
            stats={stats}
            title={t('overview.registrations')}
            points={stats.series.registrations}
          />
          <ChartCard
            stats={stats}
            title={t('overview.logins')}
            points={stats.series.logins}
            note={stats.range === '365d' ? t('overview.loginsNote') : undefined}
          />
          <ChartCard
            stats={stats}
            title={t('overview.events')}
            points={stats.series.events}
            note={t('overview.eventsNote')}
          />
          <ChartCard stats={stats} title={t('overview.rooms')} points={stats.series.rooms} />
          {stats.series.revenue.length === 0 ? (
            <Card>
              <p className="text-sm font-medium">{t('overview.revenue', { currency: 'RUB' })}</p>
              <p className="mt-3 text-sm text-muted">{t('overview.noRevenue')}</p>
            </Card>
          ) : (
            stats.series.revenue.map((series) => (
              <ChartCard
                key={series.currency}
                stats={stats}
                title={t('overview.revenue', { currency: series.currency })}
                points={series.points}
                note={t('overview.revenueNote')}
                money={series.currency}
              />
            ))
          )}
        </div>
      </section>

      <section aria-labelledby="breakdown" className="grid gap-4 xl:grid-cols-2">
        <h2 id="breakdown" className="sr-only">
          {t('overview.breakdown')}
        </h2>
        <Card>
          <h3 className="mb-2 text-sm font-medium">{t('overview.widgets')}</h3>
          <DataTable
            caption={t('overview.widgets')}
            rows={stats.widgets}
            rowKey={(row) => row.type}
            columns={[
              {
                key: 'type',
                header: t('overview.widgetType'),
                cell: (row) => t(`widgetType.${row.type}`),
              },
              {
                key: 'total',
                header: t('overview.widgetTotal'),
                align: 'end',
                cell: (row) => formatNumber(row.total),
              },
              {
                key: 'enabled',
                header: t('overview.widgetEnabled'),
                align: 'end',
                cell: (row) => formatNumber(row.enabled),
              },
            ]}
            empty={<p className="text-sm text-muted">{t('overview.empty')}</p>}
          />
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-medium">{t('overview.channels')}</h3>
          <DataTable
            caption={t('overview.channels')}
            rows={stats.channels}
            rowKey={(row) => `${row.platform}-${row.syncState}`}
            columns={[
              {
                key: 'platform',
                header: t('overview.channelPlatform'),
                cell: (row) => t(`platform.${row.platform}`),
              },
              {
                key: 'state',
                header: t('overview.channelState'),
                cell: (row) => <Status namespace="syncState" value={row.syncState} />,
              },
              {
                key: 'count',
                header: t('overview.channelCount'),
                align: 'end',
                cell: (row) => formatNumber(row.count),
              },
            ]}
            empty={<p className="text-sm text-muted">{t('overview.empty')}</p>}
          />
          <p className="mt-4 text-sm">
            <span className="text-muted">{t('overview.quota')}: </span>
            {stats.youtubeQuota
              ? t('overview.quotaValue', {
                  used: formatNumber(stats.youtubeQuota.used),
                  limit: formatNumber(stats.youtubeQuota.limit),
                })
              : t('overview.quotaOff')}
          </p>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-medium">{t('overview.eventsByProvider')}</h3>
          <DataTable
            caption={t('overview.eventsByProvider')}
            rows={[...stats.eventsByProvider].sort((a, b) => b.count - a.count)}
            rowKey={(row) => row.provider}
            columns={[
              {
                key: 'provider',
                header: t('overview.provider'),
                cell: (row) => t(`provider.${row.provider}`),
              },
              {
                key: 'count',
                header: t('overview.count'),
                align: 'end',
                cell: (row) => formatNumber(row.count),
              },
            ]}
            empty={<p className="text-sm text-muted">{t('overview.empty')}</p>}
          />
        </Card>

        {STATS_URL ? (
          <Card>
            <h3 className="text-sm font-medium">{t('overview.visits')}</h3>
            <a
              href={STATS_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-fg underline underline-offset-4"
            >
              {t('overview.visitsLink')}
              <NewTabHint />
            </a>
          </Card>
        ) : null}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  attention = false,
}: {
  label: string;
  value: string;
  hint: string;
  attention?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'rounded-card border bg-surface px-5 py-4',
        attention ? 'border-warning/60' : 'border-border',
      )}
    >
      <p className="flex items-center justify-between gap-2 text-sm text-muted">
        {label}
        {attention ? <StatusPill tone="warning">{t('overview.attention')}</StatusPill> : null}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function ChartCard({
  stats,
  title,
  points,
  note,
  money,
}: {
  stats: AdminStats;
  title: string;
  points: SeriesPoint[];
  note?: string;
  money?: Currency;
}): React.JSX.Element {
  const { t } = useTranslation();
  const weekly = stats.bucket === 'week';
  const format = money
    ? (value: number) => formatMoney({ amountMinor: value, currency: money })
    : formatNumber;
  const summary = seriesSummary(points);

  return (
    <Card>
      <TimeSeriesChart
        title={title}
        points={points}
        variant="bar"
        color={money ? MONEY_COLOR : COUNT_COLOR}
        valueLabel={money ? t('overview.amount') : t('overview.count')}
        emptyLabel={t('overview.empty')}
        summary={
          summary
            ? t(weekly ? 'overview.summaryWeek' : 'overview.summary', {
                title,
                total: format(summary.total),
                max: format(summary.max),
                last: format(summary.last),
              })
            : ''
        }
        formatTick={(at) => shortDate.format(new Date(at))}
        formatTooltipAt={(at) =>
          weekly
            ? t('overview.weekOf', { date: longDate.format(new Date(at)) })
            : longDate.format(new Date(at))
        }
        formatValue={format}
        formatAxis={money ? (value) => formatAxisMoney(value) : undefined}
      />
      {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
    </Card>
  );
}

const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Ось денег — в рублях без копеек: деление здесь только для подписи, сумма считана целой. */
function formatAxisMoney(amountMinor: number): string {
  return new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(
    Math.trunc(amountMinor / 100),
  );
}
