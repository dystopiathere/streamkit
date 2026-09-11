import { clsx, type ClassValue } from 'clsx';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from 'react';
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
  secondary: 'bg-surface text-fg border border-border hover:bg-surface-hover',
  ghost: 'text-muted hover:text-fg hover:bg-surface',
  danger: 'bg-danger text-white hover:opacity-90',
};

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
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
        'transition-opacity disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        className,
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? <span className="animate-pulse">…</span> : null}
      {children}
    </button>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg',
        'placeholder:text-muted disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

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

export function FieldError({ message }: { message?: string }): React.JSX.Element | null {
  if (!message) return null;
  return <p className="mt-1 text-xs text-danger">{message}</p>;
}
