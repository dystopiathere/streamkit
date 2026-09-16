import type { ReactNode } from 'react';
import { Button, cn } from './primitives';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Числа и суммы выравниваются по правому краю — так сравниваются разряды. */
  align?: 'start' | 'end';
  className?: string;
}

/**
 * Таблица данных.
 *
 * Прокручивается в собственном контейнере: широкая таблица на телефоне не должна
 * сдвигать всю страницу вбок. Заголовок таблицы обязателен — скринридер
 * объявляет его при входе в таблицу, а зрячему он обычно не нужен, потому что
 * таблица стоит под заголовком раздела.
 */
export function DataTable<T>({
  caption,
  captionHidden = true,
  columns,
  rows,
  rowKey,
  empty,
  className,
}: {
  caption: string;
  captionHidden?: boolean;
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  /** Что показать вместо пустой таблицы: пустая шапка выглядит как поломка. */
  empty?: ReactNode;
  className?: string;
}): React.JSX.Element {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <caption className={captionHidden ? 'sr-only' : 'mb-2 text-left text-sm text-muted'}>
          {caption}
        </caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-3 py-2 font-medium whitespace-nowrap',
                  column.align === 'end' && 'text-right',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-border align-top">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-3 py-2',
                    column.align === 'end' && 'text-right tabular-nums',
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Следующая страница курсорного списка.
 *
 * Курсор, а не номера страниц: списки сортируются по времени создания, и новая
 * запись сдвигала бы номерные страницы — одна и та же строка попадала бы на две
 * страницы подряд.
 */
export function LoadMore({
  hasMore,
  isLoading,
  onLoad,
  label,
}: {
  hasMore: boolean;
  isLoading: boolean;
  onLoad: () => void;
  label: string;
}): React.JSX.Element | null {
  if (!hasMore) return null;
  return (
    <div className="mt-4 flex justify-center">
      <Button variant="secondary" isLoading={isLoading} onClick={onLoad}>
        {label}
      </Button>
    </div>
  );
}

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const TONES: Record<StatusTone, string> = {
  neutral: 'border-border-strong text-muted',
  success: 'border-success/60 text-success',
  warning: 'border-warning/60 text-warning',
  danger: 'border-danger/60 text-danger',
  accent: 'border-accent text-fg',
};

/**
 * Статус записи.
 *
 * Цвет дублирует текст, а не заменяет его: «заблокирован» и «активен» у
 * человека с дейтеранопией различаются только словом.
 */
export function StatusPill({
  tone = 'neutral',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-card border border-dashed border-border-strong px-5 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

/** Пара «подпись — значение» в карточке записи. */
export function DetailList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}): React.JSX.Element {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className="m-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
