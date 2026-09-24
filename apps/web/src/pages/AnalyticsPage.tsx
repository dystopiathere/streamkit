import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, ConfirmDialog, EmptyState, usePageTitle } from '@streamkit/app-kit';
import { PLATFORMS_PATH } from '@/components/navigation';
import { AnalyticsHeader } from '@/features/analytics/AnalyticsHeader';
import { ChannelCard } from '@/features/analytics/ChannelCard';
import { OverviewStats, StreamDaysCard, StreamsTable } from '@/features/analytics/OverviewSummary';
import {
  useAnalyticsOverview,
  useAnalyticsRange,
  useChannels,
  useLiveChannelStats,
  useResetDonations,
} from '@/features/analytics/queries';

/**
 * «Аналитика», вкладка «Сводка»: итоги периода, площадки, эфиры.
 *
 * Числа — здесь, графики — на соседней вкладке. Подключение площадок уехало
 * в профиль: это настройка аккаунта, а не то, что смотрят каждую неделю.
 */
export function AnalyticsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [range, setRange] = useAnalyticsRange();
  const channels = useChannels();
  const overview = useAnalyticsOverview(range);
  usePageTitle(t('analytics.title'));
  useLiveChannelStats();

  return (
    <div className="space-y-6">
      <AnalyticsHeader range={range} onRangeChange={setRange} />

      {overview.data ? (
        <section aria-labelledby="analytics-period" className="space-y-3">
          <h2 id="analytics-period" className="sr-only">
            {t('analytics.stats.title')}
          </h2>
          <OverviewStats overview={overview.data} />
        </section>
      ) : (
        <p role="status" className="text-sm text-muted">
          {t('common.loading')}
        </p>
      )}

      {overview.data ? <StreamDaysCard overview={overview.data} /> : null}

      {channels.data?.length === 0 ? (
        <EmptyState title={t('analytics.emptyTitle')}>
          {t('analytics.empty')}{' '}
          <Link to={PLATFORMS_PATH} className="underline hover:text-fg">
            {t('analytics.connectInProfile')}
          </Link>
        </EmptyState>
      ) : null}

      {channels.data && channels.data.length > 0 ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {channels.data.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} range={range} />
          ))}
        </div>
      ) : null}

      {overview.data ? <StreamsTable overview={overview.data} /> : null}

      <ResetDonationsCard />
    </div>
  );
}

/**
 * Обнуление истории донатов и событий.
 *
 * Внизу сводки, а не рядом с суммами: это необратимое действие, и ему не место
 * в одном ряду с переключателем диапазона. Подтверждение обязательно —
 * восстановить историю нечем ни нам, ни площадкам.
 */
function ResetDonationsCard(): React.JSX.Element {
  const { t } = useTranslation();
  const reset = useResetDonations();
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-medium">{t('analytics.reset.title')}</h2>
      <p className="text-sm text-muted">{t('analytics.reset.text')}</p>
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        {t('analytics.reset.action')}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t('analytics.reset.confirmTitle')}
        confirmLabel={t('analytics.reset.action')}
        cancelLabel={t('common.cancel')}
        isPending={reset.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() =>
          reset.mutate(undefined, {
            onSuccess: (result) => {
              setConfirming(false);
              toast.success(t('analytics.reset.done', { count: result.removedEvents }));
            },
            onError: () => {
              setConfirming(false);
              toast.error(t('common.error'));
            },
          })
        }
      >
        {t('analytics.reset.confirmText')}
      </ConfirmDialog>
    </Card>
  );
}
