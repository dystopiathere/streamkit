import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { FieldError, Input, Label } from '@/components/ui';

/**
 * Поля формы настроек виджета.
 *
 * Обобщены по типу формы намеренно: конфиги четырёх типов виджетов не имеют
 * между собой ничего общего, кроме блока оформления текста, а поля у них одни и
 * те же — число, цвет, список, галочка. Дублировать их в каждой форме значило бы
 * четыре раза повторить, в частности, `valueAsNumber` — грабли, на которые в
 * этом проекте уже наступали.
 */
type AnyForm = UseFormReturn<FieldValues>;

interface BaseProps {
  form: AnyForm;
  name: string;
  label: string;
}

function errorAt(form: AnyForm, name: string): string | undefined {
  const message = name
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      form.formState.errors,
    );
  return (message as { message?: string } | undefined)?.message;
}

export function NumberField({
  form,
  name,
  label,
  step = 1,
  hint,
}: BaseProps & { step?: number; hint?: string }): React.JSX.Element {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type="number"
        step={step}
        // valueAsNumber обязателен: без него в схему уедет строка, и Zod
        // отвергнет форму с невнятной ошибкой про тип.
        {...form.register(name, { valueAsNumber: true })}
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      <FieldError message={errorAt(form, name)} />
    </div>
  );
}

export function TextField({ form, name, label, hint }: BaseProps & { hint?: string }) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} {...form.register(name)} />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      <FieldError message={errorAt(form, name)} />
    </div>
  );
}

export function ColorField({ form, name, label }: BaseProps): React.JSX.Element {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <div className="flex gap-2">
        <input
          id={name}
          type="color"
          className="h-9 w-12 rounded border border-border bg-bg"
          {...form.register(name)}
        />
        <Input {...form.register(name)} />
      </div>
      <FieldError message={errorAt(form, name)} />
    </div>
  );
}

export function SelectField({
  form,
  name,
  label,
  options,
}: BaseProps & { options: ReadonlyArray<{ value: string; label: string }> }): React.JSX.Element {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
        {...form.register(name)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldError message={errorAt(form, name)} />
    </div>
  );
}

export function CheckboxField({ form, name, label }: BaseProps): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm" htmlFor={name}>
      <input
        id={name}
        type="checkbox"
        className="h-4 w-4 rounded border-border bg-bg"
        {...form.register(name)}
      />
      {label}
    </label>
  );
}

/** Блок оформления текста — общий для всех типов виджетов. */
export function TextStyleFields({
  form,
  labels,
  withHighlight = false,
}: {
  form: AnyForm;
  labels: { fontSize: string; strokeWidth: string; color: string; highlightColor: string };
  withHighlight?: boolean;
}): React.JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <NumberField form={form} name="text.fontSize" label={labels.fontSize} />
      <NumberField form={form} name="text.strokeWidth" label={labels.strokeWidth} />
      <ColorField form={form} name="text.color" label={labels.color} />
      {withHighlight ? (
        <ColorField form={form} name="text.highlightColor" label={labels.highlightColor} />
      ) : null}
    </div>
  );
}
