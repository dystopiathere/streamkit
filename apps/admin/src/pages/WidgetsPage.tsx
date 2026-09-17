import { Button, DataTable, EmptyState, StatusPill } from '@streamkit/app-kit';
import { type AdminWidget, WIDGET_TYPES } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Confirm,
  ErrorState,
  FilterBar,
  ListFooter,
  Loading,
  PageHeader,
  SelectFilter,
  TableCard,
  useAdminTitle,
  useConfirm,
} from '@/components/shared';
import { WidgetTokens } from '@/components/WidgetTokens';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAdminAction, useWidgets } from '@/lib/queries';
import { useState } from 'react';

export function WidgetsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = {
    type: params.get('type') ?? undefined,
    enabled: params.get('enabled') ?? undefined,
    userId: params.get('userId') ?? undefined,
  };
  const widgets = useWidgets(filters);
  const [expanded, setExpanded] = useState<string | null>(null);
  const disable = useConfirm<AdminWidget>();
  const toggle = useAdminAction(
    ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      api.patch(`/admin/widgets/${id}`, { isEnabled }),
    t('widgets.toggled'),
  );
  useAdminTitle(t('widgets.title'));

  const setFilter = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const expandedWidget = widgets.items.find((widget) => widget.id === expanded);

  return (
    <>
      <PageHeader title={t('widgets.title')} />
      <FilterBar>
        <SelectFilter
          label={t('widgets.type')}
          value={filters.type ?? ''}
          onChange={(value) => setFilter('type', value)}
          options={[
            { value: '', label: t('widgets.anyType') },
            ...WIDGET_TYPES.map((value) => ({ value, label: t(`widgetType.${value}`) })),
          ]}
        />
        <SelectFilter
          label={t('widgets.state')}
          value={filters.enabled ?? ''}
          onChange={(value) => setFilter('enabled', value)}
          options={[
            { value: '', label: t('widgets.anyState') },
            { value: 'true', label: t('widgets.enabledOnly') },
            { value: 'false', label: t('widgets.disabledOnly') },
          ]}
        />
      </FilterBar>

      {widgets.isPending ? <Loading /> : null}
      {widgets.isError ? <ErrorState onRetry={() => void widgets.refetch()} /> : null}
      {widgets.isSuccess ? (
        <TableCard>
          <DataTable<AdminWidget>
            caption={t('widgets.caption')}
            rows={widgets.items}
            rowKey={(row) => row.id}
            empty={<EmptyState title={t('widgets.empty')} />}
            columns={[
              {
                key: 'name',
                header: t('widgets.name'),
                cell: (row) => (
                  <>
                    <span className="font-medium">{row.name}</span>
                    <span className="block text-xs text-muted">{t(`widgetType.${row.type}`)}</span>
                  </>
                ),
              },
              {
                key: 'owner',
                header: t('widgets.owner'),
                cell: (row) => (
                  <Link to={`/users/${row.userId}`} className="underline-offset-4 hover:underline">
                    {row.ownerEmail}
                  </Link>
                ),
              },
              {
                key: 'state',
                header: t('widgets.state'),
                cell: (row) => (
                  <StatusPill tone={row.isEnabled ? 'success' : 'neutral'}>
                    {row.isEnabled ? t('widgets.enabled') : t('widgets.disabled')}
                  </StatusPill>
                ),
              },
              {
                key: 'links',
                header: t('widgets.links'),
                align: 'end',
                cell: (row) => row.activeTokenCount,
              },
              {
                key: 'lastSeen',
                header: t('widgets.lastSeen'),
                cell: (row) =>
                  row.lastSeenAt ? formatDateTime(row.lastSeenAt) : t('common.never'),
                className: 'whitespace-nowrap',
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
                      aria-controls="widget-tokens"
                      aria-label={t('widgets.tokensNamed', { name: row.name })}
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      {t('widgets.tokens')}
                    </Button>
                    {row.isEnabled ? (
                      <Button
                        variant="secondary"
                        aria-label={t('widgets.disableNamed', { name: row.name })}
                        onClick={() => disable.open(row)}
                      >
                        {t('widgets.disable')}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        aria-label={t('widgets.enableNamed', { name: row.name })}
                        isLoading={toggle.isPending && toggle.variables?.id === row.id}
                        onClick={() => toggle.mutate({ id: row.id, isEnabled: true })}
                      >
                        {t('widgets.enable')}
                      </Button>
                    )}
                  </span>
                ),
              },
            ]}
          />
          <ListFooter list={widgets} />
        </TableCard>
      ) : null}

      {expandedWidget ? (
        <section id="widget-tokens" className="mt-6">
          <WidgetTokens widgetId={expandedWidget.id} name={expandedWidget.name} />
        </section>
      ) : null}

      <Confirm
        open={disable.target !== null}
        title={t('widgets.disableTitle', { name: disable.target?.name ?? '' })}
        confirmLabel={t('widgets.disable')}
        isPending={toggle.isPending}
        onClose={disable.close}
        onConfirm={() => {
          if (!disable.target) return;
          toggle.mutate({ id: disable.target.id, isEnabled: false }, { onSuccess: disable.close });
        }}
      >
        {t('widgets.disableText')}
      </Confirm>
    </>
  );
}
