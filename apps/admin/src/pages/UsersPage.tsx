import { Button, DataTable, EmptyState, Input, Label, StatusPill } from '@streamkit/app-kit';
import {
  ADMIN_SUBSCRIPTION_FILTERS,
  type AdminUserRow,
  USER_ROLES,
  USER_STATUSES,
} from '@streamkit/contracts';
import { type FormEvent, useState } from 'react';
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
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useUsers } from '@/lib/queries';

/**
 * Список пользователей. Фильтры живут в адресе: ссылку на выборку можно
 * передать коллеге, и «Назад» из карточки возвращает к той же выборке.
 */
export function UsersPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get('q') ?? undefined,
    status: params.get('status') ?? undefined,
    role: params.get('role') ?? undefined,
    subscription: params.get('subscription') ?? undefined,
  };
  const [draft, setDraft] = useState(filters.q ?? '');
  const users = useUsers(filters);
  useAdminTitle(t('users.title'));

  const setFilter = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const onSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFilter('q', draft.trim());
  };

  return (
    <>
      <PageHeader title={t('users.title')} />

      <FilterBar>
        <form role="search" onSubmit={onSearch} className="flex items-end gap-2">
          <div className="w-72 max-w-full">
            <Label htmlFor="user-search">{t('users.search')}</Label>
            <Input
              id="user-search"
              type="search"
              value={draft}
              placeholder={t('users.searchPlaceholder')}
              onChange={(event) => setDraft(event.target.value)}
              className="mt-1"
            />
          </div>
          <Button type="submit" variant="secondary">
            {t('common.search')}
          </Button>
        </form>
        <SelectFilter
          label={t('users.status')}
          value={filters.status ?? ''}
          onChange={(value) => setFilter('status', value)}
          options={[
            { value: '', label: t('users.anyStatus') },
            ...USER_STATUSES.map((value) => ({ value, label: t(`userStatus.${value}`) })),
          ]}
        />
        <SelectFilter
          label={t('users.role')}
          value={filters.role ?? ''}
          onChange={(value) => setFilter('role', value)}
          options={[
            { value: '', label: t('users.anyRole') },
            ...USER_ROLES.map((value) => ({ value, label: t(`role.${value}`) })),
          ]}
        />
        <SelectFilter
          label={t('users.subscription')}
          value={filters.subscription ?? ''}
          onChange={(value) => setFilter('subscription', value === 'any' ? '' : value)}
          options={ADMIN_SUBSCRIPTION_FILTERS.map((value) => ({
            value: value === 'any' ? '' : value,
            label: t(`subscription.${value}`),
          }))}
        />
        {params.size > 0 ? (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            {t('common.reset')}
          </Button>
        ) : null}
      </FilterBar>

      {users.isPending ? <Loading /> : null}
      {users.isError ? <ErrorState onRetry={() => void users.refetch()} /> : null}
      {users.isSuccess ? (
        <TableCard>
          <DataTable<AdminUserRow>
            caption={t('users.caption')}
            rows={users.items}
            rowKey={(row) => row.id}
            empty={<EmptyState title={t('users.empty')}>{t('users.emptyHint')}</EmptyState>}
            columns={[
              {
                key: 'user',
                header: t('users.email'),
                cell: (row) => (
                  <Link
                    to={`/users/${row.id}`}
                    className="block font-medium underline-offset-4 hover:underline"
                  >
                    {row.displayName}
                    <span className="block text-xs font-normal text-muted">{row.email}</span>
                  </Link>
                ),
              },
              {
                key: 'status',
                header: t('users.status'),
                cell: (row) => (
                  <span className="flex flex-wrap gap-1">
                    <Status namespace="userStatus" value={row.status} />
                    {row.role !== 'user' ? (
                      <StatusPill tone="accent">{t(`role.${row.role}`)}</StatusPill>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'subscription',
                header: t('users.subscription'),
                cell: (row) => <Status namespace="subscription" value={row.subscriptionStatus} />,
              },
              {
                key: 'widgets',
                header: t('users.widgets'),
                align: 'end',
                cell: (row) => formatNumber(row.widgetCount),
              },
              {
                key: 'emailVerified',
                header: t('users.emailVerified'),
                cell: (row) => (row.emailVerified ? t('common.yes') : t('common.no')),
              },
              {
                key: 'twoFactor',
                header: t('users.twoFactor'),
                cell: (row) => (row.isTotpEnabled ? t('common.yes') : t('common.no')),
              },
              {
                key: 'registered',
                header: t('users.registered'),
                cell: (row) => formatDate(row.createdAt),
                className: 'whitespace-nowrap',
              },
              {
                key: 'lastSeen',
                header: t('users.lastSeen'),
                cell: (row) =>
                  row.lastSeenAt ? formatDateTime(row.lastSeenAt) : t('common.never'),
                className: 'whitespace-nowrap',
              },
            ]}
          />
          <ListFooter list={users} />
        </TableCard>
      ) : null}
    </>
  );
}
