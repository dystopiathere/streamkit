import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  type AvailablePlatform,
} from '@streamkit/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, cn, ConfirmDialog, usePageTitle } from '@streamkit/app-kit';
import { ChannelCard } from '@/features/analytics/ChannelCard';
import {
  useChannels,
  useConnectPlatform,
  useDonationTotals,
  useLiveChannelStats,
  usePlatforms,
  useResetDonations,
} from '@/features/analytics/queries';
import { formatMoney } from '@/lib/locale';

/**
 * Аналитика подключённых площадок.
 *
 * Диапазон один на всю страницу: сравнивать каналы между собой можно только на
 * общем отрезке времени, а переключатель у каждого графика отдельно этому
 * незаметно мешает.
 */
export function AnalyticsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const channels = useChannels();
  const platforms = usePlatforms();
  const donations = useDonationTotals(range);
  usePageTitle(t('analytics.title'));

  useConnectionResult();
  useLiveChannelStats();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('analytics.title')}</h1>
        <RangePicker value={range} onChange={setRange} />
      </div>

      <ConnectPanel platforms={platforms.data ?? []} />

      {donations.data && donations.data.length > 0 ? (
        <Card className="space-y-2">
          <h2 className="text-sm font-medium">{t('analytics.donationsTitle')}</h2>
          <ul className="flex flex-wrap gap-6">
            {donations.data.map((total) => (
              <li key={total.currency}>
                <p className="text-xl font-semibold tabular-nums text-success">
                  {formatMoney({ amountMinor: total.amountMinor, currency: total.currency })}
                </p>
                <p className="text-xs text-muted">
                  {t('analytics.donationsCount', { count: total.count })}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {channels.data?.length === 0 ? (
        <Card>
          <p className="text-muted">{t('analytics.empty')}</p>
        </Card>
      ) : null}

      {channels.data?.map((channel) => (
        <ChannelCard key={channel.id} channel={channel} range={range} />
      ))}

      <ResetDonationsCard />
    </div>
  );
}

/**
 * Обнуление истории донатов и событий.
 *
 * Внизу страницы аналитики, а не рядом с суммами: это необратимое действие, и
 * ему не место в одном ряду с переключателем диапазона. Подтверждение
 * обязательно — восстановить историю нечем ни нам, ни площадкам.
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

function RangePicker({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div
      className="flex gap-1 rounded-lg border border-border-strong p-1"
      role="group"
      aria-label={t('analytics.rangeLabel')}
    >
      {ANALYTICS_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={range === value}
          onClick={() => onChange(range)}
          className={cn(
            'rounded px-3 py-1 text-sm transition-colors',
            range === value ? 'bg-accent/20 text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {t(`analytics.range.${range}`)}
        </button>
      ))}
    </div>
  );
}

/**
 * Кнопки подключения.
 *
 * Ненастроенная площадка показывается неактивной с объяснением, а не прячется:
 * иначе владелец инсталляции, забывший прописать ключи, видит ровно то же, что
 * видел бы при полностью исправной настройке без этой площадки.
 */
function ConnectPanel({ platforms }: { platforms: AvailablePlatform[] }): React.JSX.Element | null {
  const { t } = useTranslation();
  const connect = useConnectPlatform();
  const available = platforms.filter((platform) => !platform.isConnected);

  if (available.length === 0) return null;

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-medium">{t('analytics.connectTitle')}</h2>
      <div className="flex flex-wrap gap-2">
        {available.map((platform) => (
          <div key={platform.platform} className="flex flex-col gap-1">
            <Button
              variant="secondary"
              disabled={!platform.isConfigured}
              aria-describedby={
                platform.isConfigured ? undefined : `platform-${platform.platform}-hint`
              }
              isLoading={connect.isPending && connect.variables === platform.platform}
              onClick={() => connect.mutate(platform.platform)}
            >
              {t('analytics.connect', { platform: platform.title })}
            </Button>
            {!platform.isConfigured ? (
              <span id={`platform-${platform.platform}-hint`} className="text-xs text-muted">
                {t('analytics.notConfigured')}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Разбор возврата с площадки.
 *
 * Сервер приводит пользователя сюда с меткой в адресе. Метку убираем сразу:
 * иначе она переживёт перезагрузку страницы и покажет «площадка подключена»
 * через сутки после подключения.
 */
function useConnectionResult(): void {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const status = params.get('status');
  const platform = params.get('platform');

  useEffect(() => {
    if (!status) return;

    if (status === 'connected') {
      toast.success(t('analytics.connected', { platform: platform ?? '' }));
    } else if (status === 'failed') {
      toast.error(t('analytics.connectFailed'));
    }

    setParams(new URLSearchParams(), { replace: true });
  }, [status, platform, setParams, t]);
}
