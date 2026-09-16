import { clsx, type ClassValue } from 'clsx';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, type LinkProps } from 'react-router-dom';
import { twMerge } from 'tailwind-merge';

/**
 * Примитивы интерфейса.
 *
 * Написаны вручную в стиле shadcn/ui (код компонента живёт в проекте, а не в
 * зависимости) — так тему и поведение можно менять без борьбы с чужими стилями.
 * Структура специально совместима с `npx shadcn@latest add <component>`:
 * недостающие компоненты добавляются командой и кладутся рядом.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'bg-surface text-fg border border-border-strong hover:bg-surface-hover',
  ghost: 'text-muted hover:text-fg hover:bg-surface',
  danger: 'bg-danger-strong text-white hover:opacity-90',
};

/** Оформление кнопки — общее у `<button>` и у ссылки, которая выглядит как кнопка. */
export function buttonClasses(variant: ButtonVariant = 'primary', className?: string): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
    'transition-opacity disabled:opacity-50',
    BUTTON_VARIANTS[variant],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  isLoading?: boolean;
}

export function Button({
  variant = 'primary',
  isLoading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      // Тип по умолчанию у <button> внутри формы — submit. Явное значение
      // избавляет от классической ошибки «кнопка неожиданно отправила форму».
      type="button"
      className={buttonClasses(variant, className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span aria-hidden="true" className="animate-pulse">
          …
        </span>
      ) : null}
      {children}
    </button>
  );
}

/**
 * Переход, который выглядит как кнопка.
 *
 * Раньше это была `<Button>` внутри `<Link>`: кнопка внутри ссылки — недопустимая
 * разметка, скринридер объявлял два элемента вместо одного, а Tab
 * останавливался на одном месте дважды.
 */
export function ButtonLink({
  variant = 'primary',
  className,
  ...props
}: LinkProps & { variant?: ButtonVariant }): React.JSX.Element {
  return <Link className={buttonClasses(variant, className)} {...props} />;
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-border-strong bg-bg px-3 py-2 text-sm text-fg',
        'placeholder:text-muted disabled:opacity-50 aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}

/** Выпадающий список в оформлении поля ввода. */
export const selectClasses =
  'w-full rounded-lg border border-border-strong bg-bg px-3 py-2 text-sm text-fg';

export function Label({
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element {
  return (
    <label className={cn('block text-sm font-medium text-muted', className)} {...props}>
      {children}
    </label>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={cn('rounded-card border border-border bg-surface p-5', className)}>
      {children}
    </div>
  );
}

/**
 * Связь поля с подсказкой и ошибкой для скринридера.
 *
 * Без `aria-describedby` ошибка — просто красный текст рядом: зрячий видит, к
 * какому полю она относится, а скринридер при переходе на поле её не читает.
 */
export function describeField(
  id: string,
  { hint, error }: { hint?: boolean; error?: string },
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return {
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(ids.length > 0 ? { 'aria-describedby': ids.join(' ') } : {}),
  };
}

export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
      {children}
    </p>
  );
}

export function FieldError({
  id,
  message,
}: {
  /** Идентификатор поля: ошибка получает `<id>-error` для `describeField`. */
  id?: string;
  message?: string;
}): React.JSX.Element | null {
  if (!message) return null;
  return (
    <p id={id ? `${id}-error` : undefined} className="mt-1 text-xs text-danger">
      {message}
    </p>
  );
}

/** Текст только для скринридера. */
export function VisuallyHidden({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="sr-only">{children}</span>;
}

/** Подпись у ссылки, открывающейся в новой вкладке: иначе переход — сюрприз. */
export function NewTabHint(): React.JSX.Element {
  const { t } = useTranslation();
  return <VisuallyHidden>{t('common.newTab')}</VisuallyHidden>;
}
