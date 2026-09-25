import type { Channel } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@streamkit/app-kit';
import { useConnectPlatform } from './queries';

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
export function SyncNotice({ channel }: { channel: Channel }): React.JSX.Element | null {
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
          : t(`platforms.needsReconnect.${channel.platform}`)}
      </p>
      {needsAction ? (
        <Button
          variant="secondary"
          isLoading={connect.isPending}
          onClick={() => connect.mutate(channel.platform)}
        >
          {t('platforms.reconnect')}
        </Button>
      ) : null}
    </div>
  );
}
