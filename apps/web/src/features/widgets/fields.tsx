import { formatMinorForInput, parseMajorToMinor } from '@streamkit/contracts';
import { useState } from 'react';
import { Controller, type FieldValues, type UseFormReturn } from 'react-hook-form';
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

/**
 * Поле суммы: пользователь вводит РУБЛИ, форма хранит копейки.
 *
 * Раньше в поле уезжало сырое `targetMinor` с шагом 100 — то есть стример,
 * задумавший цель в тысячу рублей, должен был напечатать 100000, а стрелки
 * поля двигали сумму ровно на рубль и ни на что другое. Хранение в минорных
 * единицах при этом не обсуждается (правило 1), поэтому конвертация живёт на
 * границе ввода, а не в данных.
 *
 * Перевод идёт разбором строки, а не умножением на сто: `10.07 * 100` даёт
 * 1006.9999999999999, и это ровно тот промежуточный float, который правило
 * запрещает.
 *
 * Поле ТЕКСТОВОЕ, и это вынужденно. У `<input type="number">` значение «12.»
 * невалидно, поэтому `event.target.value` возвращает пустую строку: браузер
 * прячет от скрипта набранное, пока оно не станет числом целиком. Управляемое
 * числовое поле из-за этого стирало ввод ровно на десятичной точке, и «12.50»
 * молча превращалось в 50 ₽. Сырая строка живёт в состоянии поля, число
 * пересчитывается из неё — ровно так, как это уже сделано в форме стартовой
 * суммы цели.
 */
export function MoneyField({
  form,
  name,
  label,
  hint,
  currency,
}: BaseProps & { hint?: string; currency?: string }): React.JSX.Element {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <MoneyInput
          name={name}
          label={label}
          hint={hint}
          currency={currency}
          error={errorAt(form, name)}
          value={field.value}
          onBlur={field.onBlur}
          onChange={field.onChange}
        />
      )}
    />
  );
}

function MoneyInput({
  name,
  label,
  hint,
  currency,
  error,
  value,
  onBlur,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  currency?: string;
  error?: string;
  value: unknown;
  onBlur: () => void;
  onChange: (next: number) => void;
}): React.JSX.Element {
  const [text, setText] = useState(() => minorToText(value));
  const [seen, setSeen] = useState(value);

  // Значение пришло извне — форму наполнили после загрузки виджета. Правка
  // состояния прямо в рендере, а не в эффекте: это штатный приём React для
  // «подстроить состояние под изменившийся пропс», и он не вызывает лишнего
  // прохода по дереву, в отличие от setState внутри useEffect.
  //
  // Своё же значение переписывать нельзя: набранное «12.» вернулось бы к «12».
  if (value !== seen) {
    setSeen(value);
    if (typeof value === 'number' && Number.isFinite(value) && parseMajorToMinor(text) !== value) {
      setText(minorToText(value));
    }
  }

  return (
    <div>
      <Label htmlFor={name}>
        {label}
        {currency ? `, ${CURRENCY_SIGNS[currency] ?? currency}` : ''}
      </Label>
      <Input
        id={name}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          // Пустое поле не превращаем в ноль: пока стример стирает старое
          // значение, чтобы ввести новое, форма не должна подставлять своё.
          // NaN отвергнет схема — это честнее молчаливого нуля.
          onChange(parseMajorToMinor(next) ?? Number.NaN);
        }}
        onBlur={onBlur}
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      <FieldError message={error} />
    </div>
  );
}

function minorToText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatMinorForInput(value) : '';
}

const CURRENCY_SIGNS: Record<string, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  KZT: '₸',
  BYN: 'Br',
  UAH: '₴',
};

/**
 * Набор значений галочками.
 *
 * Одиночный список здесь не годится: цель обычно наполняют и донаты, и платные
 * подписки сразу, а таймер марафона продлевают и те, и другие. Схема массив
 * поддерживала с самого начала — ограничение было только в форме.
 */
export function CheckboxGroupField({
  form,
  name,
  label,
  options,
  hint,
}: BaseProps & {
  options: ReadonlyArray<{ value: string; label: string }>;
  hint?: string;
}): React.JSX.Element {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => {
        const selected: string[] = Array.isArray(field.value) ? (field.value as string[]) : [];

        return (
          <fieldset>
            <legend className="mb-1 text-sm text-muted">{label}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {options.map((option) => {
                const checked = selected.includes(option.value);
                return (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border bg-bg"
                      checked={checked}
                      onChange={() =>
                        // Порядок сохраняем по списку опций, а не по кликам:
                        // иначе один и тот же набор давал бы разные конфиги.
                        field.onChange(
                          options
                            .map((item) => item.value)
                            .filter((value) =>
                              value === option.value ? !checked : selected.includes(value),
                            ),
                        )
                      }
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
            {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
            <FieldError message={errorAt(form, name)} />
          </fieldset>
        );
      }}
    />
  );
}

/**
 * Список коротких значений одной строкой — например, ники скрытых ботов.
 *
 * Отдельными полями это было бы пять кнопок «добавить» ради пяти ников, а
 * `<select multiple>` не годится: набор заранее не известен, стример вписывает
 * своих. Сырая строка живёт в состоянии поля по той же причине, что и в поле
 * суммы: пока человек печатает запятую, значение ещё не разобрано, и подставлять
 * вместо него разобранное значит стирать ввод на каждом разделителе.
 */
export function TagsField({
  form,
  name,
  label,
  hint,
}: BaseProps & { hint?: string }): React.JSX.Element {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <TagsInput
          name={name}
          label={label}
          hint={hint}
          error={errorAt(form, name)}
          value={field.value}
          onBlur={field.onBlur}
          onChange={field.onChange}
        />
      )}
    />
  );
}

function TagsInput({
  name,
  label,
  hint,
  error,
  value,
  onBlur,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  value: unknown;
  onBlur: () => void;
  onChange: (next: string[]) => void;
}): React.JSX.Element {
  const [text, setText] = useState(() => tagsToText(value));
  const [seen, setSeen] = useState(value);

  if (value !== seen) {
    setSeen(value);
    const incoming = tagsToText(value);
    if (splitTags(text).join(',') !== splitTags(incoming).join(',')) {
      setText(incoming);
    }
  }

  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(splitTags(event.target.value));
        }}
        onBlur={onBlur}
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      <FieldError message={error} />
    </div>
  );
}

function splitTags(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function tagsToText(value: unknown): string {
  return Array.isArray(value) ? (value as string[]).join(', ') : '';
}
