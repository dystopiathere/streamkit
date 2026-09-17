import {
  Button,
  ConfirmDialog,
  type ConfirmDialogProps,
  Label,
  LoadMore,
  selectClasses,
  StatusPill,
  type StatusTone,
  usePageTitle,
} from '@streamkit/app-kit';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Заголовок вкладки с именем админки: её легко спутать с дашбордом в соседней вкладке. */
export function useAdminTitle(title: string | undefined): void {
  const { t } = useTranslation();
  usePageTitle(title, t('app.name'));
}

export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
      {t('common.loadError')}
      <Button variant="secondary" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

export function Loading(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <p role="status" className="text-sm text-muted">
      {t('common.loading')}
    </p>
  );
}

/** Строка фильтров над таблицей: все в одном ряду, переносятся на узком экране. */
export function FilterBar({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}

export function SelectFilter<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | '';
  options: Array<{ value: T | ''; label: string }>;
  onChange: (value: T | '') => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="min-w-44">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T | '')}
        className={`${selectClasses} mt-1`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** «Показать ещё» для курсорного списка из `useCursorList`. */
export function ListFooter({
  list,
}: {
  list: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
}): React.JSX.Element | null {
  const { t } = useTranslation();
  return (
    <LoadMore
      hasMore={list.hasNextPage}
      isLoading={list.isFetchingNextPage}
      onLoad={() => void list.fetchNextPage()}
      label={t('common.loadMore')}
    />
  );
}

export function TableCard({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="rounded-card border border-border bg-surface p-2 sm:p-3">{children}</div>;
}

const STATUS_TONES: Record<string, StatusTone> = {
  active: 'success',
  suspended: 'danger',
  anonymized: 'neutral',
  grace: 'warning',
  expired: 'neutral',
  none: 'neutral',
  pending: 'warning',
  succeeded: 'success',
  canceled: 'neutral',
  ok: 'success',
  'auth-expired': 'danger',
  'rate-limited': 'warning',
  error: 'danger',
};

/** Статус словом и цветом: `namespace` — ключ перевода (`userStatus`, `syncState`…). */
export function Status({ namespace, value }: { namespace: string; value: string }) {
  const { t } = useTranslation();
  return (
    <StatusPill tone={STATUS_TONES[value] ?? 'neutral'}>{t(`${namespace}.${value}`)}</StatusPill>
  );
}

type DialogState<T> = { target: T } | null;

/**
 * Подтверждение действия над конкретной записью.
 *
 * Одно окно на таблицу, а не по окну на строку: в списке из сотни ссылок
 * сотня `<dialog>` в документе — лишний вес и лишние остановки скринридера.
 */
export function useConfirm<T>() {
  const [state, setState] = useState<DialogState<T>>(null);
  return {
    target: state?.target ?? null,
    open: (target: T) => setState({ target }),
    close: () => setState(null),
  };
}

export function Confirm(
  props: Omit<ConfirmDialogProps, 'cancelLabel'> & { cancelLabel?: string },
): React.JSX.Element {
  const { t } = useTranslation();
  return <ConfirmDialog cancelLabel={t('common.cancel')} {...props} />;
}
