import { Button, DataTable, EmptyState } from '@streamkit/app-kit';
import { type AdminChannel, CHANNEL_SYNC_STATES, PLATFORMS } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ErrorState,
  FilterBar,
  ListFooter,
  Loading,
  PageHeader,
  SelectFilter,
  Status,
  TableCard,
  useAdminTitle,
} from '@/components/shared';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAdminAction, useChannels } from '@/lib/queries';

export function ChannelsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = {
    platform: params.get('platform') ?? undefined,
    syncState: params.get('syncState') ?? undefined,
    userId: params.get('userId') ?? undefined,
  };
  const channels = useChannels(filters);
  const resync = useAdminAction(
    (id: string) => api.post(`/admin/channels/${id}/resync`),
    t('channels.resynced'),
  );
  useAdminTitle(t('channels.title'));

  const setFilter = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title={t('channels.title')} />
      <FilterBar>
        <SelectFilter
          label={t('channels.platform')}
          value={filters.platform ?? ''}
          onChange={(value) => setFilter('platform', value)}
          options={[
            { value: '', label: t('channels.anyPlatform') },
            ...PLATFORMS.map((value) => ({ value, label: t(`platform.${value}`) })),
          ]}
        />
        <SelectFilter
          label={t('channels.state')}
          value={filters.syncState ?? ''}
          onChange={(value) => setFilter('syncState', value)}
          options={[
            { value: '', label: t('channels.anyState') },
            ...CHANNEL_SYNC_STATES.map((value) => ({ value, label: t(`syncState.${value}`) })),
          ]}
        />
      </FilterBar>

      {channels.isPending ? <Loading /> : null}
      {channels.isError ? <ErrorState onRetry={() => void channels.refetch()} /> : null}
      {channels.isSuccess ? (
        <TableCard>
          <ChannelTable
            rows={channels.items}
            onResync={(id) => resync.mutate(id)}
            pendingId={resync.isPending ? resync.variables : undefined}
          />
          <ListFooter list={channels} />
        </TableCard>
      ) : null}
    </>
  );
}

export function ChannelTable({
  rows,
  onResync,
  pendingId,
  showOwner = true,
}: {
  rows: Array<Omit<AdminChannel, 'userId' | 'ownerEmail'> & Partial<AdminChannel>>;
  onResync: (id: string) => void;
  pendingId?: string;
  showOwner?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <DataTable
      caption={t('channels.caption')}
      rows={rows}
      rowKey={(row) => row.id}
      empty={<EmptyState title={t('channels.empty')} />}
      columns={[
        {
          key: 'channel',
          header: t('channels.channel'),
          cell: (row) => (
            <>
              <span className="font-medium">{row.displayName}</span>
              <span className="block text-xs text-muted">
                {t(`platform.${row.platform}`)} · {row.login}
              </span>
            </>
          ),
        },
        ...(showOwner
          ? [
              {
                key: 'owner',
                header: t('channels.owner'),
                cell: (row: (typeof rows)[number]) =>
                  row.userId ? (
                    <Link
                      to={`/users/${row.userId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {row.ownerEmail}
                    </Link>
                  ) : null,
              },
            ]
          : []),
        {
          key: 'state',
          header: t('channels.state'),
          cell: (row) => (
            <>
              <Status namespace="syncState" value={row.syncState} />
              {row.syncError ? (
                <span className="mt-1 block max-w-72 text-xs break-words text-muted">
                  {t('channels.error')}: {row.syncError}
                </span>
              ) : null}
            </>
          ),
        },
        {
          key: 'attempts',
          header: t('channels.attempts'),
          align: 'end',
          cell: (row) => row.syncAttempts,
        },
        {
          key: 'lastSynced',
          header: t('channels.lastSynced'),
          cell: (row) => formatDateTime(row.lastSyncedAt),
          className: 'whitespace-nowrap',
        },
        {
          key: 'nextAttempt',
          header: t('channels.nextAttempt'),
          cell: (row) => formatDateTime(row.nextAttemptAt),
          className: 'whitespace-nowrap',
        },
        {
          key: 'actions',
          header: <span className="sr-only">{t('user.actions')}</span>,
          align: 'end',
          // Отозванный доступ опросом не починить — кнопки там нет.
          cell: (row) =>
            row.syncState === 'auth-expired' ? null : (
              <Button
                variant="secondary"
                isLoading={pendingId === row.id}
                aria-label={t('channels.resyncNamed', { name: row.displayName })}
                onClick={() => onResync(row.id)}
              >
                {t('channels.resync')}
              </Button>
            ),
        },
      ]}
    />
  );
}
