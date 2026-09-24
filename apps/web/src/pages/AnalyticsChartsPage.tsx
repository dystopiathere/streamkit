import {
  type AnalyticsRange,
  type Channel,
  PLATFORM_COUNTERS,
  rangeBucket,
} from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Card, usePageTitle } from '@streamkit/app-kit';
import { AnalyticsHeader } from '@/features/analytics/AnalyticsHeader';
import { MetricChart } from '@/features/analytics/MetricChart';
import {
  CorrelationChart,
  DonationHeatmap,
  EventMix,
  TimelineCharts,
} from '@/features/analytics/OverviewCharts';
import {
  useAnalyticsOverview,
  useAnalyticsRange,
  useChannels,
  useChannelSeries,
} from '@/features/analytics/queries';

/**
 * «Аналитика», вкладка «Графики»: всё, что меняется во времени и зависит друг
 * от друга.
 *
 * Сверху — стример целиком (донаты, эфиры, аудитория по дням и их связь),
 * ниже — каждая площадка отдельно: зрители и аудитория по её собственному
 * счётчику.
 */
export function AnalyticsChartsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [range, setRange] = useAnalyticsRange();
  const overview = useAnalyticsOverview(range);
  const channels = useChannels();
  usePageTitle(`${t('analytics.tabs.charts')} — ${t('analytics.title')}`);

  return (
    <div className="space-y-6">
      <AnalyticsHeader range={range} onRangeChange={setRange} />

      {overview.data ? (
        <>
          <TimelineCharts overview={overview.data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <CorrelationChart overview={overview.data} measure="donations" />
            <CorrelationChart overview={overview.data} measure="audience" />
          </div>
          <DonationHeatmap overview={overview.data} />
          <EventMix overview={overview.data} />
        </>
      ) : (
        <p role="status" className="text-sm text-muted">
          {t('common.loading')}
        </p>
      )}

      {channels.data?.map((channel) => (
        <ChannelCharts key={channel.id} channel={channel} range={range} />
      ))}
    </div>
  );
}

/** Зрители и аудитория одной площадки: её счётчик, её название. */
function ChannelCharts({
  channel,
  range,
}: {
  channel: Channel;
  range: AnalyticsRange;
}): React.JSX.Element {
  const { t } = useTranslation();
  const series = useChannelSeries(channel.id, range);
  const audience =
    PLATFORM_COUNTERS[channel.platform].audience === 'followers' ? 'followers' : 'subscribers';
  const points = series.data?.points ?? [];
  const bucket = rangeBucket(range);

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">
        {channel.displayName}{' '}
        <span className="text-sm font-normal text-muted">
          · {t(`analytics.platform.${channel.platform}`)}
        </span>
      </h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <MetricChart
          points={points}
          range={range}
          bucket={bucket}
          kind="viewers"
          title={t('analytics.chartViewers')}
          valueLabel={t('analytics.viewersNow')}
          emptyLabel={t('analytics.noLiveData')}
        />
        <MetricChart
          points={points}
          range={range}
          bucket={bucket}
          kind={audience}
          title={t(`analytics.counter.${audience}`)}
          valueLabel={t(`analytics.counter.${audience}`)}
          emptyLabel={t('analytics.noData')}
        />
      </div>
    </Card>
  );
}
