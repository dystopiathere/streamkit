import {
  ButtonLink,
  Button,
  Card,
  DataTable,
  DetailList,
  EmptyState,
  Input,
  Label,
  selectClasses,
  StatusPill,
} from '@streamkit/app-kit';
import {
  type AdminSession,
  type AdminUserDetail,
  formatMoney,
  roleAllows,
  USER_ROLES,
  type UserRole,
} from '@streamkit/contracts';
import { ArrowLeft } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  Confirm,
  ErrorState,
  Loading,
  Status,
  useAdminTitle,
  useConfirm,
} from '@/components/shared';
import { WidgetTokens } from '@/components/WidgetTokens';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useAdminAction, useAudit, useUser } from '@/lib/queries';
import { AuditTable } from './AuditPage';
import { ChannelTable } from './ChannelsPage';
import { PaymentTable } from './PaymentsPage';
import { RoomInvites } from './RoomsPage';

export function UserPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const user = useUser(id);
  useAdminTitle(user.data?.user.displayName ?? t('user.title'));

  const notFound = user.error instanceof ApiError && user.error.status === 404;

  return (
    <>
      <Link
        to="/users"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {t('user.back')}
      </Link>
      {user.isPending ? <Loading /> : null}
      {notFound ? <EmptyState title={t('common.notFound')} /> : null}
      {user.isError && !notFound ? <ErrorState onRetry={() => void user.refetch()} /> : null}
      {user.data ? <UserCard detail={user.data} /> : null}
    </>
  );
}

type Dialog =
  'suspend' | 'restore' | 'resetTotp' | 'anonymize' | 'revokeAll' | 'autoRenew' | 'extend';

function UserCard({ detail }: { detail: AdminUserDetail }): React.JSX.Element {
  const { t } = useTranslation();
  const staff = useAuthStore((state) => state.staff);
  const isAdmin = staff ? roleAllows(staff.role, 'admin') : false;
  const isSelf = staff?.id === detail.user.id;
  const { user } = detail;
  const name = user.displayName;
  const dialog = useConfirm<Dialog>();
  const [days, setDays] = useState(7);
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);

  const base = `/admin/users/${user.id}`;
  const suspend = useAdminAction(
    (reason: string) => api.post(`${base}/suspend`, { reason }),
    t('user.suspended'),
  );
  const restore = useAdminAction(() => api.post(`${base}/restore`), t('user.restored'));
  const resetTotp = useAdminAction(() => api.post(`${base}/totp/reset`), t('user.totpReset'));
  const anonymize = useAdminAction(
    (confirmEmail: string) => api.post(`${base}/anonymize`, { confirmEmail }),
    t('user.anonymized'),
  );
  const revokeSessions = useAdminAction(
    (familyId?: string) => api.post(`${base}/sessions/revoke`, familyId ? { familyId } : {}),
    t('user.sessionsRevoked'),
  );
  const setRole = useAdminAction(
    (role: UserRole) => api.patch(`${base}/role`, { role }),
    t('user.roleSaved'),
  );
  const disableAutoRenew = useAdminAction(
    () => api.patch(`${base}/subscription`, { autoRenew: false }),
    t('user.autoRenewDisabled'),
  );
  const extend = useAdminAction(
    (input: { days: number; reason: string }) => api.post(`${base}/subscription/extend`, input),
    t('user.extended'),
  );
  const resync = useAdminAction(
    (channelId: string) => api.post(`/admin/channels/${channelId}/resync`),
    t('channels.resynced'),
  );

  const anonymized = user.status === 'anonymized';
  const close = dialog.close;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{name}</h1>
          <p className="mt-1 text-sm break-all text-muted">{user.email}</p>
          <p className="mt-2 flex flex-wrap gap-2">
            <Status namespace="userStatus" value={user.status} />
            <StatusPill tone={user.role === 'user' ? 'neutral' : 'accent'}>
              {t(`role.${user.role}`)}
            </StatusPill>
            <Status namespace="subscription" value={detail.subscription.status} />
          </p>
        </div>

        {!anonymized && !isSelf ? (
          <div className="flex flex-wrap gap-2" aria-label={t('user.actions')} role="group">
            {user.isTotpEnabled ? (
              <Button variant="secondary" onClick={() => dialog.open('resetTotp')}>
                {t('user.resetTotp')}
              </Button>
            ) : null}
            {isAdmin && user.status === 'active' ? (
              <Button variant="danger" onClick={() => dialog.open('suspend')}>
                {t('user.suspend')}
              </Button>
            ) : null}
            {isAdmin && user.status === 'suspended' ? (
              <Button onClick={() => dialog.open('restore')}>{t('user.restore')}</Button>
            ) : null}
            {isAdmin ? (
              <Button variant="danger" onClick={() => dialog.open('anonymize')}>
                {t('user.anonymize')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t('user.profile')}>
          <DetailList
            items={[
              { label: t('user.id'), value: <code className="text-xs">{user.id}</code> },
              { label: t('user.registered'), value: formatDateTime(user.createdAt) },
              {
                label: t('user.lastSeen'),
                value: user.lastSeenAt ? formatDateTime(user.lastSeenAt) : t('common.never'),
              },
              {
                label: t('user.twoFactor'),
                value: user.isTotpEnabled ? t('user.twoFactorOn') : t('user.twoFactorOff'),
              },
              {
                label: t('user.role'),
                value:
                  isAdmin && !isSelf && !anonymized ? (
                    <RoleSelect
                      value={user.role}
                      onChange={(role) => {
                        setPendingRole(role);
                      }}
                    />
                  ) : (
                    t(`role.${user.role}`)
                  ),
              },
              ...(user.anonymizedAt
                ? [{ label: t('user.anonymizedAt'), value: formatDateTime(user.anonymizedAt) }]
                : []),
              {
                label: t('user.events'),
                value: (
                  <>
                    {formatNumber(detail.eventCount)}
                    <span className="block text-xs text-muted">{t('user.eventsNote')}</span>
                  </>
                ),
              },
            ]}
          />
        </Section>

        <Section
          title={t('user.subscription')}
          actions={
            isAdmin && !anonymized ? (
              <>
                {detail.subscription.autoRenew ? (
                  <Button variant="secondary" onClick={() => dialog.open('autoRenew')}>
                    {t('user.disableAutoRenew')}
                  </Button>
                ) : null}
                {user.status === 'active' ? (
                  <Button variant="secondary" onClick={() => dialog.open('extend')}>
                    {t('user.extend')}
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          <DetailList
            items={[
              {
                label: t('user.subStatus'),
                value: <Status namespace="subscription" value={detail.subscription.status} />,
              },
              {
                label: t('user.subUntil'),
                value: formatDate(detail.subscription.currentPeriodEnd),
              },
              {
                label: t('user.subAutoRenew'),
                value: detail.subscription.autoRenew ? t('common.yes') : t('common.no'),
              },
              {
                label: t('user.subAmount'),
                value: detail.subscription.renewalAmount
                  ? `${formatMoney(detail.subscription.renewalAmount)} · ${
                      detail.subscription.period ? t(`period.${detail.subscription.period}`) : ''
                    }`
                  : '—',
              },
              {
                label: t('user.subMethod'),
                value: detail.subscription.paymentMethodTitle ?? '—',
              },
            ]}
          />
        </Section>
      </div>

      <Section
        title={t('user.sessions')}
        actions={
          detail.sessions.length > 0 && !isSelf ? (
            <Button variant="secondary" onClick={() => dialog.open('revokeAll')}>
              {t('user.revokeAll')}
            </Button>
          ) : null
        }
      >
        <DataTable<AdminSession>
          caption={t('user.sessionsCaption')}
          rows={detail.sessions}
          rowKey={(row) => row.id}
          empty={<p className="text-sm text-muted">{t('user.noSessions')}</p>}
          columns={[
            {
              key: 'scope',
              header: t('user.sessionScope'),
              cell: (row) => (row.scope === 'admin' ? t('user.scopeAdmin') : t('user.scopeUser')),
            },
            {
              key: 'device',
              header: t('user.device'),
              cell: (row) => (
                <span className="block max-w-80 truncate" title={row.userAgent ?? undefined}>
                  {row.userAgent ?? '—'}
                </span>
              ),
            },
            {
              key: 'started',
              header: t('user.sessionStarted'),
              cell: (row) => formatDateTime(row.createdAt),
              className: 'whitespace-nowrap',
            },
            {
              key: 'used',
              header: t('user.sessionUsed'),
              cell: (row) => formatDateTime(row.lastUsedAt),
              className: 'whitespace-nowrap',
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('user.actions')}</span>,
              align: 'end',
              cell: (row) => (
                <Button
                  variant="ghost"
                  isLoading={revokeSessions.isPending && revokeSessions.variables === row.id}
                  aria-label={t('user.revokeSessionNamed', { date: formatDateTime(row.createdAt) })}
                  onClick={() => revokeSessions.mutate(row.id)}
                >
                  {t('user.revokeSession')}
                </Button>
              ),
            },
          ]}
        />
      </Section>

      <Section title={t('user.widgets')}>
        {detail.widgets.length === 0 ? (
          <p className="text-sm text-muted">{t('user.noWidgets')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {detail.widgets.map((widget) => (
              <div key={widget.id}>
                <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">{t(`widgetType.${widget.type}`)}</span>
                  <StatusPill tone={widget.isEnabled ? 'success' : 'neutral'}>
                    {widget.isEnabled ? t('widgets.enabled') : t('widgets.disabled')}
                  </StatusPill>
                </p>
                <WidgetTokens widgetId={widget.id} name={widget.name} tokens={widget.tokens} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={t('user.rooms')}
        actions={
          detail.rooms.length > 0 ? (
            <ButtonLink variant="ghost" to={`/rooms?userId=${user.id}`}>
              {t('nav.rooms')}
            </ButtonLink>
          ) : null
        }
      >
        {detail.rooms.length === 0 ? (
          <p className="text-sm text-muted">{t('user.noRooms')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {detail.rooms.map((room) => (
              <RoomInvites key={room.id} room={room} />
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t('user.channels')}>
          {detail.channels.length === 0 ? (
            <p className="text-sm text-muted">{t('user.noChannels')}</p>
          ) : (
            <ChannelTable
              rows={detail.channels}
              showOwner={false}
              onResync={(channelId) => resync.mutate(channelId)}
              pendingId={resync.isPending ? resync.variables : undefined}
            />
          )}
        </Section>

        <Section title={t('user.sources')}>
          <DataTable
            caption={t('user.sources')}
            rows={detail.donationSources}
            rowKey={(row) => row.provider}
            empty={<p className="text-sm text-muted">{t('user.noSources')}</p>}
            columns={[
              {
                key: 'provider',
                header: t('overview.provider'),
                cell: (row) => t(`provider.${row.provider}`),
              },
              {
                key: 'state',
                header: t('widgets.state'),
                cell: (row) => (
                  <>
                    <StatusPill tone={row.isEnabled ? 'success' : 'neutral'}>
                      {row.isEnabled ? t('widgets.enabled') : t('widgets.disabled')}
                    </StatusPill>
                    {row.disabledReason ? (
                      <span className="mt-1 block text-xs text-muted">{row.disabledReason}</span>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'lastEvent',
                header: t('widgets.lastSeen'),
                cell: (row) => formatDateTime(row.lastEventAt),
              },
            ]}
          />
        </Section>
      </div>

      <Section title={t('user.payments')}>
        <PaymentTable rows={detail.payments} />
      </Section>

      <Section title={t('user.consents')}>
        <DataTable
          caption={t('user.consentsCaption')}
          rows={detail.consents}
          rowKey={(row) => `${row.document}-${row.grantedAt}`}
          empty={<p className="text-sm text-muted">—</p>}
          columns={[
            {
              key: 'document',
              header: t('user.document'),
              cell: (row) => <code className="text-xs">{row.document}</code>,
            },
            { key: 'version', header: t('user.version'), cell: (row) => row.documentVersion },
            {
              key: 'granted',
              header: t('user.granted'),
              cell: (row) => formatDateTime(row.grantedAt),
            },
            {
              key: 'revoked',
              header: t('user.revoked'),
              cell: (row) => formatDateTime(row.revokedAt),
            },
          ]}
        />
      </Section>

      {isAdmin ? <UserAudit userId={user.id} /> : null}

      {/* Подтверждения. Одно окно открыто за раз. */}
      <Confirm
        open={dialog.target === 'suspend'}
        title={t('user.suspendTitle', { name })}
        confirmLabel={t('user.suspend')}
        reason={{
          label: t('user.suspendReason'),
          hint: t('user.suspendReasonHint'),
          required: true,
          maxLength: 500,
        }}
        isPending={suspend.isPending}
        onClose={close}
        onConfirm={({ reason }) => suspend.mutate(reason ?? '', { onSuccess: close })}
      >
        {t('user.suspendText')}
      </Confirm>
      <Confirm
        open={dialog.target === 'restore'}
        variant="primary"
        title={t('user.restoreTitle', { name })}
        confirmLabel={t('user.restore')}
        isPending={restore.isPending}
        onClose={close}
        onConfirm={() => restore.mutate(undefined, { onSuccess: close })}
      >
        {t('user.restoreText')}
      </Confirm>
      <Confirm
        open={dialog.target === 'resetTotp'}
        title={t('user.resetTotpTitle', { name })}
        confirmLabel={t('user.resetTotp')}
        isPending={resetTotp.isPending}
        onClose={close}
        onConfirm={() => resetTotp.mutate(undefined, { onSuccess: close })}
      >
        {t('user.resetTotpText')}
      </Confirm>
      <Confirm
        open={dialog.target === 'anonymize'}
        title={t('user.anonymizeTitle', { name })}
        confirmLabel={t('user.anonymize')}
        confirmText={{
          label: t('user.anonymizeConfirm', { email: user.email }),
          expected: user.email,
        }}
        isPending={anonymize.isPending}
        onClose={close}
        onConfirm={({ confirmText }) => anonymize.mutate(confirmText ?? '', { onSuccess: close })}
      >
        {t('user.anonymizeText')}
      </Confirm>
      <Confirm
        open={dialog.target === 'revokeAll'}
        title={t('user.revokeAllTitle', { name })}
        confirmLabel={t('user.revokeAll')}
        isPending={revokeSessions.isPending}
        onClose={close}
        onConfirm={() => revokeSessions.mutate(undefined, { onSuccess: close })}
      >
        {t('user.revokeAllText')}
      </Confirm>
      <Confirm
        open={dialog.target === 'autoRenew'}
        title={t('user.disableAutoRenewTitle', { name })}
        confirmLabel={t('user.disableAutoRenew')}
        isPending={disableAutoRenew.isPending}
        onClose={close}
        onConfirm={() => disableAutoRenew.mutate(undefined, { onSuccess: close })}
      >
        {t('user.disableAutoRenewText')}
      </Confirm>
      <Confirm
        open={dialog.target === 'extend'}
        variant="primary"
        title={t('user.extendTitle', { name })}
        confirmLabel={t('user.extend')}
        reason={{ label: t('user.extendReason'), required: true, maxLength: 500 }}
        isPending={extend.isPending}
        onClose={close}
        onConfirm={({ reason }) =>
          extend.mutate({ days, reason: reason ?? '' }, { onSuccess: close })
        }
      >
        <p>{t('user.extendText')}</p>
        <DaysField value={days} onChange={setDays} />
      </Confirm>
      <Confirm
        open={pendingRole !== null}
        variant="primary"
        title={t('user.roleTitle', { role: pendingRole ? t(`role.${pendingRole}`) : '' })}
        confirmLabel={t('user.changeRole')}
        isPending={setRole.isPending}
        onClose={() => setPendingRole(null)}
        onConfirm={() => {
          if (pendingRole) setRole.mutate(pendingRole, { onSuccess: () => setPendingRole(null) });
        }}
      >
        {t('user.roleText')}
      </Confirm>
    </div>
  );
}

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const id = useId();
  return (
    <Card>
      <section aria-labelledby={id}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        {children}
      </section>
    </Card>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: UserRole;
  onChange: (role: UserRole) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const id = useId();
  return (
    <>
      <Label htmlFor={id} className="sr-only">
        {t('user.changeRole')}
      </Label>
      {/* Выбор не сохраняет сам: смена роли подтверждается отдельно. Поэтому
          список управляемый и всегда показывает сохранённую роль. */}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as UserRole)}
        className={`${selectClasses} max-w-48`}
      >
        {USER_ROLES.map((role) => (
          <option key={role} value={role}>
            {t(`role.${role}`)}
          </option>
        ))}
      </select>
    </>
  );
}

function DaysField({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="mt-3 text-fg">
      <Label htmlFor={id}>{t('user.extendDays')}</Label>
      <Input
        id={id}
        type="number"
        min={1}
        max={366}
        value={value}
        onChange={(event) => onChange(Math.min(366, Math.max(1, Number(event.target.value) || 1)))}
        className="mt-1 w-32 tabular-nums"
      />
    </div>
  );
}

function UserAudit({ userId }: { userId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const audit = useAudit({ userId });
  return (
    <Section title={t('user.audit')}>
      {audit.isPending ? <Loading /> : null}
      {audit.isError ? <ErrorState onRetry={() => void audit.refetch()} /> : null}
      {audit.isSuccess ? <AuditTable rows={audit.items.slice(0, 50)} /> : null}
    </Section>
  );
}
