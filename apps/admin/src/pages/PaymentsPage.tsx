import { Button, DataTable, EmptyState } from '@streamkit/app-kit';
import {
  type AdminPayment,
  formatMoney,
  PAYMENT_STATUSES,
  type PaymentView,
} from '@streamkit/contracts';
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
import { useAdminAction, usePayments } from '@/lib/queries';

export function PaymentsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = {
    status: params.get('status') ?? undefined,
    userId: params.get('userId') ?? undefined,
  };
  const payments = usePayments(filters);
  const sync = useAdminAction(
    (id: string) => api.post(`/admin/payments/${id}/sync`),
    t('payments.synced'),
  );
  useAdminTitle(t('payments.title'));

  return (
    <>
      <PageHeader title={t('payments.title')} />
      <p className="-mt-3 mb-4 text-sm text-muted">{t('payments.refundsNote')}</p>
      <FilterBar>
        <SelectFilter
          label={t('payments.status')}
          value={filters.status ?? ''}
          onChange={(value) => {
            const next = new URLSearchParams(params);
            if (value) next.set('status', value);
            else next.delete('status');
            setParams(next, { replace: true });
          }}
          options={[
            { value: '', label: t('payments.anyStatus') },
            ...PAYMENT_STATUSES.map((value) => ({ value, label: t(`paymentStatus.${value}`) })),
          ]}
        />
      </FilterBar>

      {payments.isPending ? <Loading /> : null}
      {payments.isError ? <ErrorState onRetry={() => void payments.refetch()} /> : null}
      {payments.isSuccess ? (
        <TableCard>
          <PaymentTable
            rows={payments.items}
            onSync={(id) => sync.mutate(id)}
            pendingId={sync.isPending ? sync.variables : undefined}
          />
          <ListFooter list={payments} />
        </TableCard>
      ) : null}
    </>
  );
}

type PaymentRow = PaymentView &
  Partial<Pick<AdminPayment, 'userId' | 'ownerEmail' | 'cancellationReason'>>;

export function PaymentTable({
  rows,
  onSync,
  pendingId,
}: {
  rows: PaymentRow[];
  onSync?: (id: string) => void;
  pendingId?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const withOwner = rows.some((row) => row.ownerEmail);
  return (
    <DataTable<PaymentRow>
      caption={t('payments.caption')}
      rows={rows}
      rowKey={(row) => row.id}
      empty={<EmptyState title={t('payments.empty')} />}
      columns={[
        {
          key: 'created',
          header: t('payments.created'),
          cell: (row) => formatDateTime(row.createdAt),
          className: 'whitespace-nowrap',
        },
        ...(withOwner
          ? [
              {
                key: 'owner',
                header: t('payments.owner'),
                cell: (row: PaymentRow) => (
                  <Link to={`/users/${row.userId}`} className="underline-offset-4 hover:underline">
                    {row.ownerEmail}
                  </Link>
                ),
              },
            ]
          : []),
        {
          key: 'kind',
          header: t('payments.kind'),
          cell: (row) => `${t(`paymentKind.${row.kind}`)} · ${t(`period.${row.period}`)}`,
        },
        {
          key: 'status',
          header: t('payments.status'),
          cell: (row) => (
            <>
              <Status namespace="paymentStatus" value={row.status} />
              {row.cancellationReason ? (
                <span className="mt-1 block text-xs text-muted">
                  {t('payments.reason')}: {row.cancellationReason}
                </span>
              ) : null}
            </>
          ),
        },
        {
          key: 'paid',
          header: t('payments.paid'),
          cell: (row) => formatDateTime(row.paidAt),
          className: 'whitespace-nowrap',
        },
        {
          key: 'amount',
          header: t('payments.amount'),
          align: 'end',
          cell: (row) => (
            <>
              {formatMoney({ amountMinor: row.amountMinor, currency: row.currency })}
              {row.refundedAmountMinor > 0 ? (
                <span className="block text-xs text-muted">
                  {t('user.refunded', {
                    amount: formatMoney({
                      amountMinor: row.refundedAmountMinor,
                      currency: row.currency,
                    }),
                  })}
                </span>
              ) : null}
            </>
          ),
        },
        ...(onSync
          ? [
              {
                key: 'actions',
                header: <span className="sr-only">{t('user.actions')}</span>,
                align: 'end' as const,
                cell: (row: PaymentRow) =>
                  row.status === 'pending' ? (
                    <Button
                      variant="secondary"
                      isLoading={pendingId === row.id}
                      aria-label={t('payments.syncNamed', { date: formatDateTime(row.createdAt) })}
                      onClick={() => onSync(row.id)}
                    >
                      {t('payments.sync')}
                    </Button>
                  ) : null,
              },
            ]
          : []),
      ]}
    />
  );
}
