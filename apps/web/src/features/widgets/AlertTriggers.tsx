import {
  ALERT_APPEARANCE_FIELDS,
  type AlertEventType,
  type AlertTrigger,
  CURRENCIES,
  MAX_ALERT_TRIGGERS,
  matchAlertTrigger,
  TRIGGER_OPERATORS,
} from '@streamkit/contracts';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { type FieldValues, useFieldArray, type UseFormReturn, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button, cn, Input } from '@streamkit/app-kit';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/locale';
import { MoneyField, SelectField } from './fields';
import { useSendTestAlert } from './queries';
import { triggerSampleAmount } from './WidgetPreview';

/** Сумма нового триггера: тысяча — самая частая первая ступень у стримеров. */
const NEW_TRIGGER_AMOUNT = 100_000;

/**
 * Триггеры доната: вид оповещения по сумме, по приоритету.
 *
 * Номер у триггера — это порядок проверки, а не украшение: срабатывает первый
 * подошедший, и «сначала ровно 1000, потом меньше 10 000» работает только в
 * таком порядке. Поэтому номер виден, а стрелки меняют его явно, а не
 * перетаскиванием, которое не повторить с клавиатуры.
 *
 * Вид триггера правится теми же разделами, что и вид сценария: «Настроить вид»
 * переключает разделы на этот триггер. Вторая копия формы оформления разошлась
 * бы с первой при первой же новой настройке.
 */
export function AlertTriggers({
  form,
  scenario,
  editing,
  onEdit,
}: {
  form: UseFormReturn<FieldValues>;
  scenario: AlertEventType;
  /** Триггер, чей вид правят сейчас; null — вид самого сценария. */
  editing: string | null;
  /** Переключить разделы на вид триггера (или обратно на сценарий — null). */
  onEdit: (triggerId: string | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const name = `scenarios.${scenario}.triggers`;
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name });
  const triggers = (useWatch({ control: form.control, name }) ?? []) as AlertTrigger[];
  const sendTest = useSendTestAlert();

  const add = (): void => {
    // Новый триггер начинается с вида сценария: стример меняет в нём одно-два
    // поля, а не собирает оповещение с нуля.
    const base = form.getValues(`scenarios.${scenario}`) as Record<string, unknown>;
    const appearance = Object.fromEntries(
      ALERT_APPEARANCE_FIELDS.map((field) => [field, structuredClone(base[field])]),
    );
    const currency = triggers.at(-1)?.condition.currency ?? 'RUB';
    append({
      id: crypto.randomUUID(),
      name: '',
      condition: { operator: 'gte', currency, amountMinor: NEW_TRIGGER_AMOUNT, toMinor: null },
      ...appearance,
    });
  };

  const drop = (index: number): void => {
    if (triggers[index]?.id === editing) onEdit(null);
    remove(index);
  };

  const test = async (trigger: AlertTrigger): Promise<void> => {
    try {
      await sendTest.mutateAsync({ type: scenario, amount: triggerSampleAmount(trigger) });
      toast.success(t('widgets.scenario.testSent'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  };

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm text-muted">{t('widgets.triggers.intro')}</p>

      <ol className="space-y-3" aria-label={t('widgets.triggers.listLabel')}>
        {fields.map((field, index) => {
          const trigger = triggers[index];
          if (!trigger) return null;
          const at = (path: string): string => `${name}.${index}.${path}`;
          const summary = conditionSummary(t, trigger.condition);
          const title = trigger.name.trim() || summary;
          // Пример доната под условие этого триггера ловит триггер выше — значит
          // этот сработает только на суммы, которые тот пропустит (или никогда).
          const sample = triggerSampleAmount(trigger);
          const shadow = matchAlertTrigger(
            { triggers: triggers.slice(0, index) },
            { amount: sample },
          );
          const active = trigger.id === editing;

          return (
            <li
              key={field.id}
              className={cn(
                'space-y-4 rounded-lg border p-4',
                active ? 'border-fg bg-surface-hover/40' : 'border-border',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded bg-surface-hover px-1.5 text-xs font-semibold tabular-nums"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <Input
                  aria-label={t('widgets.triggers.name', { number: index + 1 })}
                  placeholder={summary}
                  maxLength={60}
                  className="min-w-0 flex-1"
                  {...form.register(at('name'))}
                />
                <IconButton
                  label={t('widgets.triggers.up', { name: title })}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp aria-hidden="true" className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={t('widgets.triggers.down', { name: title })}
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown aria-hidden="true" className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={t('common.deleteNamed', { name: title })}
                  onClick={() => drop(index)}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </IconButton>
              </div>

              <div
                className={cn(
                  'grid gap-3',
                  trigger.condition.operator === 'between'
                    ? 'sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]'
                    : 'sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)]',
                )}
              >
                <SelectField
                  form={form}
                  name={at('condition.operator')}
                  label={t('widgets.triggers.operatorLabel')}
                  options={TRIGGER_OPERATORS.map((value) => ({
                    value,
                    label: t(`widgets.triggers.operator.${value}`),
                  }))}
                />
                <MoneyField
                  form={form}
                  name={at('condition.amountMinor')}
                  label={
                    trigger.condition.operator === 'between'
                      ? t('widgets.triggers.from')
                      : t('widgets.triggers.amount')
                  }
                  currency={trigger.condition.currency}
                />
                {trigger.condition.operator === 'between' ? (
                  <MoneyField
                    form={form}
                    name={at('condition.toMinor')}
                    label={t('widgets.triggers.to')}
                    currency={trigger.condition.currency}
                  />
                ) : null}
                <SelectField
                  form={form}
                  name={at('condition.currency')}
                  label={t('widgets.triggers.currency')}
                  options={CURRENCIES.map((value) => ({ value, label: value }))}
                />
              </div>

              {shadow ? (
                <p className="text-xs text-warning">
                  {t('widgets.triggers.shadowed', {
                    amount: formatMoney(sample),
                    name: shadow.name.trim() || conditionSummary(t, shadow.condition),
                  })}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  aria-pressed={active}
                  onClick={() => onEdit(active ? null : trigger.id)}
                >
                  {active ? t('widgets.triggers.editing') : t('widgets.triggers.edit')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void test(trigger)}
                  disabled={sendTest.isPending}
                  aria-label={t('widgets.triggers.testNamed', { name: title })}
                >
                  {t('widgets.triggers.test', { amount: formatMoney(sample) })}
                </Button>
              </div>
            </li>
          );
        })}

        {/* Основной вид — последним и без номера: он срабатывает, когда не
            подошёл ни один триггер, а убрать или поднять его нельзя. */}
        <li
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4',
            editing === null ? 'border-fg' : 'border-border-strong',
          )}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('widgets.triggers.fallback')}</p>
            <p className="text-xs text-muted">{t('widgets.triggers.fallbackHint')}</p>
          </div>
          <Button variant="secondary" aria-pressed={editing === null} onClick={() => onEdit(null)}>
            {editing === null ? t('widgets.triggers.editing') : t('widgets.triggers.edit')}
          </Button>
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={add} disabled={fields.length >= MAX_ALERT_TRIGGERS}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          {t('widgets.triggers.add')}
        </Button>
        <span className="text-xs text-muted tabular-nums">
          {t('widgets.triggers.count', { used: fields.length, max: MAX_ALERT_TRIGGERS })}
        </span>
      </div>
    </div>
  );
}

/** Условие словами: «от 1 000 ₽», «ровно 500 ₽», «от 500 до 999 ₽». */
export function conditionSummary(
  t: (key: string, options?: Record<string, unknown>) => string,
  condition: AlertTrigger['condition'],
): string {
  const money = (amountMinor: number | null): string =>
    formatMoney({ amountMinor: amountMinor ?? 0, currency: condition.currency });
  return t(`widgets.triggers.summary.${condition.operator}`, {
    amount: money(condition.amountMinor),
    to: money(condition.toMinor),
  });
}

/** Квадратная кнопка-значок. Подпись — для диктора, она же подсказка мыши. */
export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      className="h-9 w-9 shrink-0 p-0"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
