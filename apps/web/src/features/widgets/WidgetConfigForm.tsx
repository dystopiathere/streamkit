import {
  ALERT_EVENT_TYPES,
  ALERT_TEMPLATE_VARS,
  CURRENCIES,
  GUEST_LAYOUTS,
  TOP_DONORS_PERIODS,
  type WidgetType,
} from '@streamkit/contracts';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { useChannels } from '@/features/analytics/queries';
import {
  CheckboxField,
  CheckboxGroupField,
  ColorField,
  MoneyField,
  NumberField,
  SelectField,
  TagsField,
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
    case 'chat':
      return <ChatFields form={form} />;
    case 'guests':
      return <GuestsFields form={form} />;
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
          <MoneyField
            form={form}
            name="minAmountMinor"
            label={t('widgets.field.minAmount')}
            hint={t('widgets.hint.minAmount')}
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
  // Знак валюты в подписи поля суммы следует за выбранной валютой: иначе
  // «Цель, ₽» стояло бы над суммой в долларах.
  const currency = String(form.watch('currency') ?? 'RUB');

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.goal')}</h2>
        <TextField form={form} name="title" label={t('widgets.field.goalTitle')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            form={form}
            name="targetMinor"
            label={t('widgets.field.targetMinor')}
            currency={currency}
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
        <CheckboxGroupField
          form={form}
          name="countTypes"
          label={t('widgets.field.countTypes')}
          options={eventTypeOptions(t)}
          hint={t('widgets.hint.countTypes')}
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
  const currency = String(form.watch('currency') ?? 'RUB');

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
            label={t('widgets.field.secondsPerUnit', { currency })}
            hint={t('widgets.hint.secondsPerUnit', { currency })}
          />
          <SelectField
            form={form}
            name="currency"
            label={t('widgets.field.currency')}
            options={currencyOptions()}
          />
        </div>
        <CheckboxGroupField
          form={form}
          name="countTypes"
          label={t('widgets.field.countTypes')}
          options={eventTypeOptions(t)}
          hint={t('widgets.hint.countTypes')}
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

/* ------------------------------------------------------------------ */

function ChatFields({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const textLabels = useTextLabels();
  // Подключённый канал Twitch подставляется подсказкой, а не молча: чат читается
  // анонимно, и виджет обязан работать у того, кто площадку не подключал вовсе.
  const channels = useChannels();
  const twitch = channels.data?.find((channel) => channel.platform === 'twitch');

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.chat')}</h2>
        <TextField
          form={form}
          name="channel"
          label={t('widgets.field.channel')}
          hint={
            twitch
              ? t('widgets.hint.channelConnected', { channel: twitch.login })
              : t('widgets.hint.channel')
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField form={form} name="maxMessages" label={t('widgets.field.maxMessages')} />
          <NumberField
            form={form}
            name="messageLifetimeSeconds"
            label={t('widgets.field.messageLifetime')}
            step={10}
            hint={t('widgets.hint.messageLifetime')}
          />
        </div>
        <TagsField
          form={form}
          name="hiddenUsers"
          label={t('widgets.field.hiddenUsers')}
          hint={t('widgets.hint.hiddenUsers')}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <CheckboxField form={form} name="hideCommands" label={t('widgets.field.hideCommands')} />
          <CheckboxField form={form} name="showBadges" label={t('widgets.field.showBadges')} />
          <CheckboxField form={form} name="showEmotes" label={t('widgets.field.showEmotes')} />
          <CheckboxField form={form} name="newestFirst" label={t('widgets.field.newestFirst')} />
          <CheckboxField
            form={form}
            name="useAuthorColors"
            label={t('widgets.field.useAuthorColors')}
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.appearance')}</h2>
        <TextStyleFields form={form} labels={textLabels} withHighlight />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */

function GuestsFields({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const textLabels = useTextLabels();

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.guests')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            form={form}
            name="layout"
            label={t('widgets.field.guestsLayout')}
            options={GUEST_LAYOUTS.map((value) => ({
              value,
              label: t(`widgets.guestsLayout.${value}`),
            }))}
          />
          <NumberField form={form} name="maxTiles" label={t('widgets.field.maxTiles')} />
          <NumberField form={form} name="gap" label={t('widgets.field.tileGap')} />
          <NumberField form={form} name="cornerRadius" label={t('widgets.field.cornerRadius')} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <CheckboxField form={form} name="showNames" label={t('widgets.field.showNames')} />
          <CheckboxField
            form={form}
            name="showWithoutVideo"
            label={t('widgets.field.showWithoutVideo')}
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.appearance')}</h2>
        <TextStyleFields form={form} labels={textLabels} />
      </Card>
    </>
  );
}
