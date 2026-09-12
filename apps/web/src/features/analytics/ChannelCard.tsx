import type { AnalyticsRange, Channel } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/components/ui';
import { useChannelSeries, useChannelSummary, useDisconnectChannel } from './queries';
import { MetricChart } from './MetricChart';

interface ChannelCardProps {
  channel: Channel;
  range: AnalyticsRange;
}

export function ChannelCard({ channel, range }: ChannelCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const summary = useChannelSummary(channel.id, range);
  const series = useChannelSeries(channel.id, range);
  const disconnect = useDisconnectChannel();

  return (
    <Card className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        {channel.avatarUrl ? (
          <img
            src={channel.avatarUrl}
            alt=""
            className="h-10 w-10 rounded-full border border-border"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium">
            <span className="truncate">{channel.displayName}</span>
            {summary.data?.current?.isLive ? (
              // Состояние передаётся формой и текстом, а не только цветом.
              <span className="shrink-0 rounded bg-danger/15 px-1.5 py-0.5 text-xs text-danger">
                {t('analytics.live')}
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted">
            {t(`analytics.platform.${channel.platform}`)} · {channel.login}
          </p>
        </div>

        <Button
          variant="ghost"
          onClick={() => disconnect.mutate(channel.id)}
          isLoading={disconnect.isPending}
        >
          {t('analytics.disconnect')}
        </Button>
      </header>

      <SyncNotice channel={channel} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={t('analytics.viewersNow')}
          value={summary.data?.current?.isLive ? summary.data.current.viewers : null}
        />
        <Stat
          label={t('analytics.subscribers')}
          value={summary.data?.current?.subscribers ?? null}
          delta={summary.data?.deltas.subscribers ?? null}
        />
        <Stat
          label={t('analytics.followers')}
          value={summary.data?.current?.followers ?? null}
          delta={summary.data?.deltas.followers ?? null}
        />
        <Stat
          label={t('analytics.liveHours')}
          value={summary.data?.liveHours ?? null}
          suffix={t('analytics.hoursSuffix')}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <MetricChart
          points={series.data?.points ?? []}
          range={range}
          kind="viewers"
          title={t('analytics.chartViewers')}
          valueLabel={t('analytics.viewersNow')}
          emptyLabel={t('analytics.noLiveData')}
        />
        <MetricChart
          points={series.data?.points ?? []}
          range={range}
          kind="subscribers"
          title={t('analytics.chartSubscribers')}
          valueLabel={t('analytics.subscribers')}
          emptyLabel={t('analytics.noData')}
        />
      </div>
    </Card>
  );
}

/**
 * Состояние сбора.
 *
 * Показывается только когда оно требует действия или объяснения: «всё в
 * порядке» отдельной строкой — шум, который учит не читать это место.
 */
function SyncNotice({ channel }: { channel: Channel }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (channel.syncState === 'ok') return null;

  const isAuth = channel.syncState === 'auth-expired';
  return (
    <p
      className={
        isAuth
          ? 'rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm'
          : 'rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-muted'
      }
    >
      {t(`analytics.syncState.${channel.syncState}`)}
    </p>
  );
}

interface StatProps {
  label: string;
  value: number | null;
  delta?: number | null;
  suffix?: string;
}

function Stat({ label, value, delta, suffix }: StatProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">
        {value === null ? (
          // Прочерк, а не ноль: «неизвестно» и «ноль» — разные утверждения, и
          // площадки регулярно не отдают часть счётчиков.
          <span className="text-muted">{t('analytics.noValue')}</span>
        ) : (
          <>
            {new Intl.NumberFormat('ru-RU').format(value)}
            {suffix ? <span className="ml-1 text-sm font-normal text-muted">{suffix}</span> : null}
          </>
        )}
      </p>
      {delta !== undefined && delta !== null && delta !== 0 ? (
        <p className={delta > 0 ? 'text-xs text-success' : 'text-xs text-muted'}>
          {delta > 0 ? '+' : ''}
          {new Intl.NumberFormat('ru-RU').format(delta)}
        </p>
      ) : null}
    </div>
  );
}
