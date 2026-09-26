import { describeUserAgent, type SessionInfo } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button, Card, StatusPill } from '@streamkit/app-kit';
import { intlLocale } from '@/lib/locale';
import { useRevokeSession, useSessions } from './queries';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString(intlLocale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Где открыт аккаунт. Чужое устройство в списке — повод сменить пароль, а
 * «Выйти» у строки закрывает его, не трогая остальные.
 */
export function SessionsCard(): React.JSX.Element {
  const { t } = useTranslation();
  const sessions = useSessions();
  const revoke = useRevokeSession();

  return (
    <section aria-labelledby="sessions-title">
      <Card className="space-y-3">
        <div className="space-y-1">
          <h2 id="sessions-title" className="font-medium">
            {t('security.sessions.title')}
          </h2>
          <p className="text-sm text-muted">{t('security.sessions.description')}</p>
        </div>

        {sessions.isLoading ? (
          <p role="status" className="text-sm text-muted">
            {t('common.loading')}
          </p>
        ) : null}

        <ul className="divide-y divide-border">
          {sessions.data?.map((session: SessionInfo) => {
            const name =
              describeUserAgent(session.userAgent) ?? t('security.sessions.unknownDevice');
            return (
              <li key={session.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{name}</span>
                    {session.isCurrent ? (
                      <StatusPill tone="accent">{t('security.sessions.current')}</StatusPill>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">
                    {t('security.sessions.lastUsed', { date: formatDate(session.lastUsedAt) })}
                  </p>
                </div>
                {session.isCurrent ? null : (
                  <Button
                    variant="ghost"
                    aria-label={t('security.sessions.revokeNamed', { name })}
                    isLoading={revoke.isPending && revoke.variables === session.id}
                    onClick={() =>
                      revoke.mutate(session.id, {
                        onSuccess: () => toast.success(t('security.sessions.revoked')),
                        onError: () => toast.error(t('common.error')),
                      })
                    }
                  >
                    {t('security.sessions.revoke')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
