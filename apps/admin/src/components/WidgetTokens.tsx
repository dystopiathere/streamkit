import { Button, Card, DataTable, EmptyState, StatusPill } from '@streamkit/app-kit';
import type { AdminOverlayToken } from '@streamkit/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAdminAction } from '@/lib/queries';
import { Confirm, ErrorState, Loading, useConfirm } from './shared';

/**
 * Ссылки OBS одного виджета: отзыв по одной и все сразу.
 *
 * Список ссылок читается отдельным запросом, а не лежит в строке виджета:
 * отозванные тоже нужны — по ним видно, когда и кто гасил доступ.
 */
export function WidgetTokens({
  widgetId,
  name,
  tokens: initial,
}: {
  widgetId: string;
  name: string;
  /** Ссылки уже известны (карточка пользователя) — отдельный запрос не нужен. */
  tokens?: AdminOverlayToken[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['admin', 'tokens', widgetId],
    queryFn: () => api.get<AdminOverlayToken[]>(`/admin/widgets/${widgetId}/tokens`),
    enabled: initial === undefined,
  });
  const tokens = initial ?? query.data;
  const revokeOne = useConfirm<AdminOverlayToken>();
  const revokeAll = useConfirm<true>();
  const revoke = useAdminAction(
    (tokenId: string) => api.delete(`/admin/widgets/${widgetId}/tokens/${tokenId}`),
    t('widgets.revoked'),
  );
  const revokeEverything = useAdminAction(
    () => api.post(`/admin/widgets/${widgetId}/tokens/revoke-all`),
    t('widgets.revoked'),
  );

  const label = (token: AdminOverlayToken): string => token.label ?? t('widgets.noLabel');
  const active = tokens?.filter((token) => !token.revokedAt).length ?? 0;

  return (
    <Card className="p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('widgets.tokensNamed', { name })}</h3>
        {active > 0 ? (
          <Button variant="danger" onClick={() => revokeAll.open(true)}>
            {t('widgets.revokeAll')}
          </Button>
        ) : null}
      </div>

      {!tokens && query.isPending ? <Loading /> : null}
      {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : null}
      {tokens ? (
        <DataTable<AdminOverlayToken>
          caption={t('widgets.tokensCaption', { name })}
          rows={tokens}
          rowKey={(row) => row.id}
          empty={<EmptyState title={t('widgets.noTokens')} />}
          columns={[
            { key: 'label', header: t('widgets.label'), cell: label },
            {
              key: 'state',
              header: t('widgets.state'),
              cell: (row) =>
                row.revokedAt ? (
                  <StatusPill>
                    {t('widgets.revokedAt')} {formatDateTime(row.revokedAt)}
                  </StatusPill>
                ) : (
                  <StatusPill tone="success">{t('widgets.active')}</StatusPill>
                ),
            },
            {
              key: 'created',
              header: t('widgets.created'),
              cell: (row) => formatDateTime(row.createdAt),
              className: 'whitespace-nowrap',
            },
            {
              key: 'lastSeen',
              header: t('widgets.lastSeen'),
              cell: (row) => (row.lastSeenAt ? formatDateTime(row.lastSeenAt) : t('common.never')),
              className: 'whitespace-nowrap',
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('user.actions')}</span>,
              align: 'end',
              cell: (row) =>
                row.revokedAt ? null : (
                  <Button
                    variant="secondary"
                    aria-label={t('widgets.revokeNamed', { label: label(row) })}
                    onClick={() => revokeOne.open(row)}
                  >
                    {t('widgets.revoke')}
                  </Button>
                ),
            },
          ]}
        />
      ) : null}

      <Confirm
        open={revokeOne.target !== null}
        title={t('widgets.revokeTitle', { label: revokeOne.target ? label(revokeOne.target) : '' })}
        confirmLabel={t('widgets.revoke')}
        isPending={revoke.isPending}
        onClose={revokeOne.close}
        onConfirm={() => {
          if (revokeOne.target) revoke.mutate(revokeOne.target.id, { onSuccess: revokeOne.close });
        }}
      >
        {t('widgets.revokeText')}
      </Confirm>
      <Confirm
        open={revokeAll.target !== null}
        title={t('widgets.revokeAllTitle', { name })}
        confirmLabel={t('widgets.revokeAll')}
        isPending={revokeEverything.isPending}
        onClose={revokeAll.close}
        onConfirm={() => revokeEverything.mutate(undefined, { onSuccess: revokeAll.close })}
      >
        {t('widgets.revokeAllText')}
      </Confirm>
    </Card>
  );
}
