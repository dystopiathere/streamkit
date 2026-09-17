import { Button, DataTable, EmptyState, Input, Label } from '@streamkit/app-kit';
import type { AdminAuditEntry } from '@streamkit/contracts';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ErrorState,
  FilterBar,
  ListFooter,
  Loading,
  PageHeader,
  TableCard,
  useAdminTitle,
} from '@/components/shared';
import { formatDateTime } from '@/lib/format';
import { useAudit } from '@/lib/queries';

export function AuditPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const action = params.get('action') ?? undefined;
  const [draft, setDraft] = useState(action ?? '');
  const audit = useAudit({ action, userId: params.get('userId') ?? undefined });
  useAdminTitle(t('audit.title'));

  const apply = (value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set('action', value);
    else next.delete('action');
    setParams(next, { replace: true });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    apply(draft.trim());
  };

  return (
    <>
      <PageHeader title={t('audit.title')} />
      <p className="-mt-3 mb-4 text-sm text-muted">{t('audit.retention')}</p>
      <FilterBar>
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <div className="w-72 max-w-full">
            <Label htmlFor="audit-action">{t('audit.action')}</Label>
            <Input
              id="audit-action"
              value={draft}
              placeholder={t('audit.actionPlaceholder')}
              pattern="[a-z_.]*"
              onChange={(event) => setDraft(event.target.value)}
              className="mt-1 font-mono"
            />
          </div>
          <Button type="submit" variant="secondary">
            {t('common.search')}
          </Button>
        </form>
        <Button
          variant="ghost"
          aria-pressed={action === 'admin.'}
          onClick={() => {
            setDraft('admin.');
            apply('admin.');
          }}
        >
          {t('audit.onlyStaff')}
        </Button>
      </FilterBar>

      {audit.isPending ? <Loading /> : null}
      {audit.isError ? <ErrorState onRetry={() => void audit.refetch()} /> : null}
      {audit.isSuccess ? (
        <TableCard>
          <AuditTable rows={audit.items} />
          <ListFooter list={audit} />
        </TableCard>
      ) : null}
    </>
  );
}

export function AuditTable({ rows }: { rows: AdminAuditEntry[] }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <DataTable<AdminAuditEntry>
      caption={t('audit.caption')}
      rows={rows}
      rowKey={(row) => row.id}
      empty={<EmptyState title={t('audit.empty')} />}
      columns={[
        {
          key: 'time',
          header: t('audit.time'),
          cell: (row) => formatDateTime(row.createdAt),
          className: 'whitespace-nowrap',
        },
        {
          key: 'action',
          header: t('audit.action'),
          cell: (row) => <code className="text-xs">{row.action}</code>,
        },
        {
          key: 'subject',
          header: t('audit.subject'),
          cell: (row) =>
            row.userId ? (
              <Link to={`/users/${row.userId}`} className="underline-offset-4 hover:underline">
                {row.userEmail}
              </Link>
            ) : (
              '—'
            ),
        },
        {
          key: 'actor',
          header: t('audit.actor'),
          cell: (row) =>
            row.actorId ? (
              <Link to={`/users/${row.actorId}`} className="underline-offset-4 hover:underline">
                {row.actorEmail}
              </Link>
            ) : (
              <span className="text-muted">{t('audit.self')}</span>
            ),
        },
        {
          key: 'details',
          header: t('audit.details'),
          // Метаданные — идентификаторы и причины; показываются как есть,
          // текстом, а не разметкой.
          cell: (row) =>
            row.metadata ? (
              <code className="block max-w-96 text-xs break-all whitespace-pre-wrap text-muted">
                {JSON.stringify(row.metadata)}
              </code>
            ) : null,
        },
      ]}
    />
  );
}
