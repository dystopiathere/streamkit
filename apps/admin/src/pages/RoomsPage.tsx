import { Button, Card, DataTable, EmptyState, StatusPill } from '@streamkit/app-kit';
import type { AdminInvite, AdminRoom } from '@streamkit/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Confirm,
  ErrorState,
  ListFooter,
  Loading,
  PageHeader,
  TableCard,
  useAdminTitle,
  useConfirm,
} from '@/components/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatDateTime } from '@/lib/format';
import { useAdminAction, useInvites, useRooms } from '@/lib/queries';

export function RoomsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const rooms = useRooms({ userId: params.get('userId') ?? undefined });
  const [expanded, setExpanded] = useState<string | null>(null);
  const isAdmin = useAuthStore((state) => state.staff?.role === 'admin');
  const remove = useConfirm<AdminRoom>();
  const removeRoom = useAdminAction(
    (id: string) => api.delete(`/admin/rooms/${id}`),
    t('rooms.deleted'),
  );
  useAdminTitle(t('rooms.title'));

  const expandedRoom = rooms.items.find((room) => room.id === expanded);

  return (
    <>
      <PageHeader title={t('rooms.title')} />
      {rooms.isPending ? <Loading /> : null}
      {rooms.isError ? <ErrorState onRetry={() => void rooms.refetch()} /> : null}
      {rooms.isSuccess ? (
        <TableCard>
          <DataTable<AdminRoom>
            caption={t('rooms.caption')}
            rows={rooms.items}
            rowKey={(row) => row.id}
            empty={<EmptyState title={t('rooms.empty')} />}
            columns={[
              {
                key: 'name',
                header: t('rooms.name'),
                cell: (row) => <span className="font-medium">{row.name}</span>,
              },
              {
                key: 'owner',
                header: t('rooms.owner'),
                cell: (row) => (
                  <Link to={`/users/${row.userId}`} className="underline-offset-4 hover:underline">
                    {row.ownerEmail}
                  </Link>
                ),
              },
              {
                key: 'created',
                header: t('rooms.created'),
                cell: (row) => formatDateTime(row.createdAt),
                className: 'whitespace-nowrap',
              },
              {
                key: 'invites',
                header: t('rooms.invites'),
                align: 'end',
                cell: (row) => row.activeInviteCount,
              },
              {
                key: 'actions',
                header: <span className="sr-only">{t('user.actions')}</span>,
                align: 'end',
                cell: (row) => (
                  <span className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      aria-expanded={expanded === row.id}
                      aria-controls="room-invites"
                      aria-label={t('rooms.invitesNamed', { name: row.name })}
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      {t('rooms.showInvites')}
                    </Button>
                    {isAdmin ? (
                      <Button
                        variant="danger"
                        aria-label={t('rooms.deleteNamed', { name: row.name })}
                        onClick={() => remove.open(row)}
                      >
                        {t('rooms.delete')}
                      </Button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
          <ListFooter list={rooms} />
        </TableCard>
      ) : null}

      {expandedRoom ? (
        <section id="room-invites" className="mt-6">
          <RoomInvites room={expandedRoom} />
        </section>
      ) : null}

      <Confirm
        open={remove.target !== null}
        title={t('rooms.deleteTitle', { name: remove.target?.name ?? '' })}
        confirmLabel={t('rooms.delete')}
        confirmText={{
          label: t('rooms.deleteConfirm', { name: remove.target?.name ?? '' }),
          expected: remove.target?.name ?? '',
        }}
        isPending={removeRoom.isPending}
        onClose={remove.close}
        onConfirm={() => {
          if (remove.target) removeRoom.mutate(remove.target.id, { onSuccess: remove.close });
        }}
      >
        {t('rooms.deleteText')}
      </Confirm>
    </>
  );
}

export function RoomInvites({ room }: { room: Pick<AdminRoom, 'id' | 'name'> }) {
  const { t } = useTranslation();
  const invites = useInvites(room.id, true);
  const confirm = useConfirm<AdminInvite>();
  const revoke = useAdminAction(
    (inviteId: string) => api.delete(`/admin/rooms/${room.id}/invites/${inviteId}`),
    t('rooms.revoked'),
  );

  return (
    <Card className="p-3">
      <h3 className="mb-2 text-sm font-medium">{t('rooms.invitesNamed', { name: room.name })}</h3>
      {invites.isPending ? <Loading /> : null}
      {invites.isError ? <ErrorState onRetry={() => void invites.refetch()} /> : null}
      {invites.data ? (
        <DataTable<AdminInvite>
          caption={t('rooms.invitesCaption', { name: room.name })}
          rows={invites.data}
          rowKey={(row) => row.id}
          empty={<EmptyState title={t('rooms.noInvites')} />}
          columns={[
            {
              key: 'created',
              header: t('rooms.created'),
              cell: (row) => formatDateTime(row.createdAt),
              className: 'whitespace-nowrap',
            },
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
              key: 'lastUsed',
              header: t('rooms.lastUsed'),
              cell: (row) => (row.lastUsedAt ? formatDateTime(row.lastUsedAt) : t('common.never')),
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
                    aria-label={t('rooms.revokeNamed', { created: formatDateTime(row.createdAt) })}
                    onClick={() => confirm.open(row)}
                  >
                    {t('rooms.revoke')}
                  </Button>
                ),
            },
          ]}
        />
      ) : null}
      <Confirm
        open={confirm.target !== null}
        title={t('rooms.revokeTitle', {
          created: confirm.target ? formatDateTime(confirm.target.createdAt) : '',
        })}
        confirmLabel={t('rooms.revoke')}
        isPending={revoke.isPending}
        onClose={confirm.close}
        onConfirm={() => {
          if (confirm.target) revoke.mutate(confirm.target.id, { onSuccess: confirm.close });
        }}
      >
        {t('rooms.revokeText')}
      </Confirm>
    </Card>
  );
}
