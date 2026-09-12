import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  type AvailablePlatform,
  formatMoney,
} from '@streamkit/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, cn } from '@/components/ui';
import { ChannelCard } from '@/features/analytics/ChannelCard';
import {
  useChannels,
  useConnectPlatform,
  useDonationTotals,
  usePlatforms,
} from '@/features/analytics/queries';

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

  useConnectionResult();

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
    </div>
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
    <div className="flex gap-1 rounded-lg border border-border p-1" role="group">
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
              isLoading={connect.isPending && connect.variables === platform.platform}
              onClick={() => connect.mutate(platform.platform)}
            >
              {t('analytics.connect', { platform: platform.title })}
            </Button>
            {!platform.isConfigured ? (
              <span className="text-xs text-muted">{t('analytics.notConfigured')}</span>
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
