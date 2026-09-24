import type { AvailablePlatform, Channel } from '@streamkit/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  StatusPill,
  usePageTitle,
} from '@streamkit/app-kit';
import { SyncNotice } from '@/features/analytics/SyncNotice';
import {
  useChannels,
  useConnectPlatform,
  useDisconnectChannel,
  usePlatforms,
  useSetChannelEnabled,
} from '@/features/analytics/queries';
import { intlLocale } from '@/lib/locale';

/**
 * Подключённые площадки: подключение, активность на тарифе, починка доступа и
 * отключение.
 *
 * Жило внизу «Аналитики», но это не аналитика: от подключения зависят чат,
 * события Twitch и окно эфира, а цифры по площадкам — только одно из
 * следствий. Здесь — аккаунты, в «Аналитике» — что они показали.
 */
export function PlatformsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const channels = useChannels();
  const platforms = usePlatforms();
  usePageTitle(t('platforms.title'));
  useConnectionResult();

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('platforms.title')}</h1>
        <p className="text-sm text-muted">{t('platforms.description')}</p>
      </div>

      <ConnectPanel platforms={platforms.data ?? []} />

      {channels.data?.length === 0 ? (
        <EmptyState title={t('platforms.emptyTitle')}>{t('platforms.empty')}</EmptyState>
      ) : null}

      {channels.data?.map((channel) => (
        <ChannelConnection key={channel.id} channel={channel} />
      ))}

      <p className="text-sm text-muted">
        {t('platforms.donationsHint')}{' '}
        <Link to="/sources" className="underline hover:text-fg">
          {t('nav.sources')}
        </Link>
      </p>
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
      <h2 className="text-sm font-medium">{t('platforms.connectTitle')}</h2>
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
              {t('platforms.connect', { platform: platform.title })}
            </Button>
            {!platform.isConfigured ? (
              <span id={`platform-${platform.platform}-hint`} className="text-xs text-muted">
                {t('platforms.notConfigured')}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChannelConnection({ channel }: { channel: Channel }): React.JSX.Element {
  const { t } = useTranslation();
  const disconnect = useDisconnectChannel();
  const setEnabled = useSetChannelEnabled();
  // Отключение стирает все собранные метрики сразу и безвозвратно — как и
  // обещает политика. Одним случайным нажатием такое не делается.
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        {channel.avatarUrl ? (
          <img
            src={channel.avatarUrl}
            alt=""
            className="h-10 w-10 rounded-full border border-border"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{channel.displayName}</span>
            <StatusPill tone={channel.isEnabled ? 'success' : 'neutral'}>
              {channel.isEnabled ? t('platforms.active') : t('platforms.inactiveShort')}
            </StatusPill>
          </h2>
          <p className="truncate text-xs text-muted">
            {t(`analytics.platform.${channel.platform}`)} · {channel.login}
            {channel.lastSyncedAt
              ? ` · ${t('platforms.lastSynced', {
                  date: new Date(channel.lastSyncedAt).toLocaleString(intlLocale(), {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}`
              : null}
          </p>
        </div>

        {/* Выключенная площадка не опрашивается, не читает чат и не шлёт
            события: так работает тариф с одной активной площадкой у того, кто
            подключил две. Включение одной выключает другую — это делает сервер. */}
        {channel.isEnabled ? null : (
          <Button
            variant="secondary"
            isLoading={setEnabled.isPending}
            aria-label={t('platforms.activateNamed', { name: channel.displayName })}
            onClick={() => setEnabled.mutate({ channelId: channel.id, isEnabled: true })}
          >
            {t('platforms.activate')}
          </Button>
        )}
        <Button
          variant="ghost"
          aria-label={t('platforms.disconnectNamed', { name: channel.displayName })}
          onClick={() => setConfirming(true)}
        >
          {t('platforms.disconnect')}
        </Button>
        <ConfirmDialog
          open={confirming}
          title={t('platforms.disconnectTitle', { name: channel.displayName })}
          confirmLabel={t('platforms.disconnect')}
          cancelLabel={t('common.cancel')}
          isPending={disconnect.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={() => disconnect.mutate(channel.id, { onSettled: () => setConfirming(false) })}
        >
          {t('platforms.disconnectText')}
        </ConfirmDialog>
      </header>

      {channel.isEnabled ? null : (
        <p className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-muted">
          {t('platforms.inactive')}
        </p>
      )}

      <SyncNotice channel={channel} />
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
      toast.success(t('platforms.connected', { platform: platform ?? '' }));
    } else if (status === 'plan-limit') {
      // Не ошибка: стример сделал всё правильно, просто на его тарифе площадок
      // меньше. Тост объясняет, что делать, и не предлагает «попробовать ещё раз».
      toast.error(t('platforms.connectPlanLimit'), { duration: 8_000 });
    } else if (status === 'failed') {
      toast.error(t('platforms.connectFailed'));
    }

    setParams(new URLSearchParams(), { replace: true });
  }, [status, platform, setParams, t]);
}
