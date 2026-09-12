import {
  ALERT_EVENT_TYPES,
  ALERT_TEMPLATE_VARS,
  CURRENCIES,
  TOP_DONORS_PERIODS,
  type WidgetType,
} from '@streamkit/contracts';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import {
  CheckboxField,
  ColorField,
  NumberField,
  SelectField,
  TextField,
  TextStyleFields,
} from './fields';

const ANIMATIONS = ['fade', 'slide-up', 'slide-left', 'zoom', 'bounce'] as const;
const LAYOUTS = ['center', 'banner', 'side'] as const;

/**
 * Форма настроек под тип виджета.
 *
 * Одна точка ветвления вместо четырёх страниц: общая обвязка редактора (имя,
 * ссылки OBS, предпросмотр, кнопка сохранения) у всех типов одна, различается
 * только набор полей.
 */
export function WidgetConfigForm({
  type,
  form,
}: {
  type: WidgetType;
  form: UseFormReturn<FieldValues>;
}): React.JSX.Element {
  switch (type) {
    case 'alerts':
      return <AlertsFields form={form} />;
    case 'goal':
      return <GoalFields form={form} />;
    case 'timer':
      return <TimerFields form={form} />;
    case 'top-donors':
      return <TopDonorsFields form={form} />;
  }
}

function useTextLabels() {
  const { t } = useTranslation();
  return {
    fontSize: t('widgets.field.fontSize'),
    strokeWidth: t('widgets.field.strokeWidth'),
    color: t('widgets.field.color'),
    highlightColor: t('widgets.field.highlightColor'),
  };
}

function eventTypeOptions(t: (key: string) => string) {
  return ALERT_EVENT_TYPES.map((value) => ({ value, label: t(`events.type.${value}`) }));
}

function currencyOptions() {
  return CURRENCIES.map((value) => ({ value, label: value }));
}

/* ------------------------------------------------------------------ */

function AlertsFields({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const textLabels = useTextLabels();

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.behavior')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            form={form}
            name="layout"
            label={t('widgets.field.layout')}
            options={LAYOUTS.map((value) => ({ value, label: value }))}
          />
          <NumberField
            form={form}
            name="durationMs"
            label={t('widgets.field.durationMs')}
            step={500}
          />
          <NumberField form={form} name="gapMs" label={t('widgets.field.gapMs')} step={100} />
          <NumberField
            form={form}
            name="minAmountMinor"
            label={t('widgets.field.minAmount')}
            step={100}
          />
          <SelectField
            form={form}
            name="animationIn"
            label={t('widgets.field.animationIn')}
            options={ANIMATIONS.map((value) => ({ value, label: value }))}
          />
          <SelectField
            form={form}
            name="animationOut"
            label={t('widgets.field.animationOut')}
            options={ANIMATIONS.map((value) => ({ value, label: value }))}
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.text')}</h2>
        <TextField
          form={form}
          name="titleTemplate"
          label={t('widgets.field.titleTemplate')}
          hint={t('widgets.templateHint', {
            vars: ALERT_TEMPLATE_VARS.map((name) => `{${name}}`).join(', '),
          })}
        />
        <TextField form={form} name="messageTemplate" label={t('widgets.field.messageTemplate')} />
        <TextStyleFields form={form} labels={textLabels} withHighlight />
      </Card>
    </>
  );
}

function GoalFields({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const textLabels = useTextLabels();

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.goal')}</h2>
        <TextField form={form} name="title" label={t('widgets.field.goalTitle')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            form={form}
            name="targetMinor"
            label={t('widgets.field.targetMinor')}
            step={100}
            hint={t('widgets.hint.minorUnits')}
          />
          <SelectField
            form={form}
            name="currency"
            label={t('widgets.field.currency')}
            options={currencyOptions()}
          />
        </div>
        {/* Единственная валюта на цель — не ограничение реализации, а решение:
            складывать рубли с долларами нельзя, а пересчёт по курсу менял бы
            собранную сумму задним числом. Стример должен об этом знать. */}
        <p className="text-xs text-muted">{t('widgets.hint.goalCurrency')}</p>
        {/* Один тип события, а не набор: 95% целей считают донаты, а
            мультивыбор в форме стоит заметно дороже, чем добавляет. */}
        <SelectField
          form={form}
          name="countTypes.0"
          label={t('widgets.field.countTypes')}
          options={eventTypeOptions(t)}
        />
        <CheckboxField form={form} name="showAmounts" label={t('widgets.field.showAmounts')} />
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.appearance')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField form={form} name="barColor" label={t('widgets.field.barColor')} />
          <ColorField form={form} name="trackColor" label={t('widgets.field.trackColor')} />
        </div>
        <TextStyleFields form={form} labels={textLabels} />
      </Card>
    </>
  );
}

function TimerFields({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const textLabels = useTextLabels();

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.timer')}</h2>
        <TextField form={form} name="title" label={t('widgets.field.timerTitle')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            form={form}
            name="initialSeconds"
            label={t('widgets.field.initialSeconds')}
            step={60}
          />
          <NumberField
            form={form}
            name="maxSeconds"
            label={t('widgets.field.maxSeconds')}
            step={3600}
          />
          <NumberField
            form={form}
            name="secondsPerUnit"
            label={t('widgets.field.secondsPerUnit')}
            hint={t('widgets.hint.secondsPerUnit')}
          />
          <SelectField
            form={form}
            name="currency"
            label={t('widgets.field.currency')}
            options={currencyOptions()}
          />
        </div>
        <SelectField
          form={form}
          name="countTypes.0"
          label={t('widgets.field.countTypes')}
          options={eventTypeOptions(t)}
        />
        <CheckboxField form={form} name="showHours" label={t('widgets.field.showHours')} />
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.appearance')}</h2>
        <TextStyleFields form={form} labels={textLabels} />
      </Card>
    </>
  );
}

function TopDonorsFields({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const textLabels = useTextLabels();

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.topDonors')}</h2>
        <TextField form={form} name="title" label={t('widgets.field.topDonorsTitle')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            form={form}
            name="period"
            label={t('widgets.field.period')}
            options={TOP_DONORS_PERIODS.map((value) => ({
              value,
              label: t(`widgets.period.${value}`),
            }))}
          />
          <NumberField form={form} name="limit" label={t('widgets.field.limit')} />
          <SelectField
            form={form}
            name="currency"
            label={t('widgets.field.currency')}
            options={currencyOptions()}
          />
        </div>
        <CheckboxField form={form} name="showAmounts" label={t('widgets.field.showAmounts')} />
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.appearance')}</h2>
        <TextStyleFields form={form} labels={textLabels} />
      </Card>
    </>
  );
}
