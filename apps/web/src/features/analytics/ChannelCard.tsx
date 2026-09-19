import type { AnalyticsRange, Channel } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Button, Card, cn, ConfirmDialog } from '@streamkit/app-kit';
import { useState } from 'react';
import {
  useChannelSeries,
  useChannelSummary,
  useConnectPlatform,
  useDisconnectChannel,
} from './queries';
import { MetricChart } from './MetricChart';
import { intlLocale } from '@/lib/locale';

interface ChannelCardProps {
  channel: Channel;
  range: AnalyticsRange;
}

export function ChannelCard({ channel, range }: ChannelCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const summary = useChannelSummary(channel.id, range);
  const series = useChannelSeries(channel.id, range);
  const disconnect = useDisconnectChannel();
  // Отключение стирает все собранные метрики сразу и безвозвратно — как и
  // обещает политика. Одним случайным нажатием такое не делается.
  const [confirming, setConfirming] = useState(false);

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
          <h2 className="flex items-center gap-2 font-medium">
            <span className="truncate">{channel.displayName}</span>
            {summary.data?.current?.isLive ? (
              // Состояние передаётся формой и текстом, а не только цветом.
              <span className="shrink-0 rounded bg-danger/15 px-1.5 py-0.5 text-xs text-danger">
                {t('analytics.live')}
              </span>
            ) : null}
          </h2>
          <p className="truncate text-xs text-muted">
            {t(`analytics.platform.${channel.platform}`)} · {channel.login}
          </p>
        </div>

        <Button
          variant="ghost"
          aria-label={t('analytics.disconnectNamed', { name: channel.displayName })}
          onClick={() => setConfirming(true)}
        >
          {t('analytics.disconnect')}
        </Button>
        <ConfirmDialog
          open={confirming}
          title={t('analytics.disconnectTitle', { name: channel.displayName })}
          confirmLabel={t('analytics.disconnect')}
          cancelLabel={t('common.cancel')}
          isPending={disconnect.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={() => disconnect.mutate(channel.id, { onSettled: () => setConfirming(false) })}
        >
          {t('analytics.disconnectText')}
        </ConfirmDialog>
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
 *
 * Мёртвый доступ и нехватка прав чинятся одним и тем же — повторным входом на
 * площадку, поэтому кнопка прямо здесь: подключение обновляет канал, а не
 * заводит новый.
 */
function SyncNotice({ channel }: { channel: Channel }): React.JSX.Element | null {
  const { t } = useTranslation();
  const connect = useConnectPlatform();
  const isAuth = channel.syncState === 'auth-expired';
  const needsAction = isAuth || channel.needsReconnect;
  if (channel.syncState === 'ok' && !channel.needsReconnect) return null;

  return (
    <div
      role={needsAction ? 'alert' : undefined}
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm',
        needsAction ? 'border-danger/40 bg-danger/10' : 'border-border bg-surface-hover text-muted',
      )}
    >
      <p>
        {isAuth || channel.syncState !== 'ok'
          ? t(`analytics.syncState.${channel.syncState}`)
          : t('analytics.needsReconnect')}
      </p>
      {needsAction ? (
        <Button
          variant="secondary"
          isLoading={connect.isPending}
          onClick={() => connect.mutate(channel.platform)}
        >
          {t('analytics.reconnect')}
        </Button>
      ) : null}
    </div>
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
      <p className="mt-0.5 text-lg font-semibold tabular-nums sm:text-xl">
        {value === null ? (
          // Прочерк, а не ноль: «неизвестно» и «ноль» — разные утверждения, и
          // площадки регулярно не отдают часть счётчиков.
          <span className="text-muted">
            <span aria-hidden="true">{t('analytics.noValue')}</span>
            <span className="sr-only">{t('common.noData')}</span>
          </span>
        ) : (
          <>
            {new Intl.NumberFormat(intlLocale()).format(value)}
            {suffix ? <span className="ml-1 text-sm font-normal text-muted">{suffix}</span> : null}
          </>
        )}
      </p>
      {delta !== undefined && delta !== null && delta !== 0 ? (
        <p className={delta > 0 ? 'text-xs text-success' : 'text-xs text-muted'}>
          {delta > 0 ? '+' : ''}
          {new Intl.NumberFormat(intlLocale()).format(delta)}
        </p>
      ) : null}
    </div>
  );
}
