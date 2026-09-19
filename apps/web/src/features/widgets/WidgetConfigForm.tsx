import {
  ALERT_EVENT_TYPES,
  ALERT_TEMPLATE_VARS,
  type AlertEventType,
  CHAT_PLATFORMS,
  CURRENCIES,
  GUEST_LAYOUTS,
  TOP_DONORS_PERIODS,
  type WidgetType,
} from '@streamkit/contracts';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Card, cn } from '@streamkit/app-kit';
import { toast } from 'sonner';
import { useChannels } from '@/features/analytics/queries';
import { useRooms } from '@/features/rooms/queries';
import { ApiError } from '@/lib/api';
import { useSendTestAlert } from './queries';
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
  alertScenario,
  onAlertScenarioChange,
}: {
  type: WidgetType;
  form: UseFormReturn<FieldValues>;
  /** Открытый сценарий оповещений — его же показывает предпросмотр. */
  alertScenario: AlertEventType;
  onAlertScenarioChange: (scenario: AlertEventType) => void;
}): React.JSX.Element {
  switch (type) {
    case 'alerts':
      return (
        <AlertsFields
          form={form}
          scenario={alertScenario}
          onScenarioChange={onAlertScenarioChange}
        />
      );
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

function AlertsFields({
  form,
  scenario,
  onScenarioChange,
}: {
  form: UseFormReturn<FieldValues>;
  scenario: AlertEventType;
  onScenarioChange: (scenario: AlertEventType) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.behavior')}</h2>
        <NumberField
          form={form}
          name="gapMs"
          label={t('widgets.field.gapMs')}
          step={100}
          hint={t('widgets.hint.gapMs')}
        />
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-medium">{t('widgets.scenario.title')}</h2>
          <p className="text-xs text-muted">{t('widgets.scenario.hint')}</p>
        </div>
        <ScenarioTabs form={form} selected={scenario} onSelect={onScenarioChange} />
        {/* Поля одного сценария на экране за раз; значения остальных форма
            держит сама (shouldUnregister выключен) и сохраняет все разом. */}
        <div
          key={scenario}
          role="tabpanel"
          id={`scenario-panel-${scenario}`}
          aria-labelledby={`scenario-tab-${scenario}`}
        >
          <ScenarioFields form={form} type={scenario} />
        </div>
      </Card>
    </>
  );
}

/**
 * Вкладки сценариев. Выключенный сценарий зачёркнут и подписан словом для
 * экранного диктора: его видно не только по цвету.
 */
function ScenarioTabs({
  form,
  selected,
  onSelect,
}: {
  form: UseFormReturn<FieldValues>;
  selected: AlertEventType;
  onSelect: (scenario: AlertEventType) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scenarios = (form.watch('scenarios') ?? {}) as Partial<
    Record<AlertEventType, { enabled?: boolean }>
  >;

  // Стрелки двигают выбор по кругу — как у любых вкладок (WAI-ARIA Tabs).
  const move = (from: AlertEventType, step: number): void => {
    const count = ALERT_EVENT_TYPES.length;
    const next = ALERT_EVENT_TYPES[(ALERT_EVENT_TYPES.indexOf(from) + step + count) % count]!;
    onSelect(next);
    document.getElementById(`scenario-tab-${next}`)?.focus();
  };

  return (
    <div role="tablist" aria-label={t('widgets.scenario.title')} className="flex flex-wrap gap-1.5">
      {ALERT_EVENT_TYPES.map((type) => {
        const active = type === selected;
        const enabled = scenarios[type]?.enabled !== false;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            id={`scenario-tab-${type}`}
            aria-selected={active}
            aria-controls={`scenario-panel-${type}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(type)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') move(type, 1);
              if (event.key === 'ArrowLeft') move(type, -1);
            }}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm',
              active
                ? 'border-accent bg-accent/15 text-fg'
                : 'border-border text-muted hover:text-fg',
              !enabled && 'line-through',
            )}
          >
            {t(`events.type.${type}`)}
            {enabled ? null : <span className="sr-only">, {t('widgets.scenario.off')}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Порог количества — там, где количество у события есть. У доната порог — сумма. */
const COUNT_THRESHOLDS: Partial<Record<AlertEventType, string>> = {
  gift: 'widgets.field.minGifts',
  resubscription: 'widgets.field.minMonths',
  cheer: 'widgets.field.minBits',
  raid: 'widgets.field.minRaiders',
};

/** Что копирует «оформление в остальные сценарии»: вид, но не тексты, медиа и пороги. */
const DESIGN_FIELDS = ['layout', 'durationMs', 'animationIn', 'animationOut', 'text'] as const;

function ScenarioFields({
  form,
  type,
}: {
  form: UseFormReturn<FieldValues>;
  type: AlertEventType;
}): React.JSX.Element {
  const { t } = useTranslation();
  const textLabels = useTextLabels();
  const sendTest = useSendTestAlert();
  const prefix = `scenarios.${type}.`;
  const at = (field: string): string => `${prefix}${field}`;
  const countLabel = COUNT_THRESHOLDS[type];
  const animationOptions = ANIMATIONS.map((value) => ({
    value,
    label: t(`widgets.animation.${value}`),
  }));

  const test = async (): Promise<void> => {
    try {
      await sendTest.mutateAsync(type);
      toast.success(t('widgets.scenario.testSent'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  };

  // Копия уходит в форму, а не на сервер: до «Сохранить» её можно отменить
  // перезагрузкой страницы.
  const copyDesign = (): void => {
    for (const other of ALERT_EVENT_TYPES) {
      if (other === type) continue;
      for (const field of DESIGN_FIELDS) {
        form.setValue(`scenarios.${other}.${field}`, structuredClone(form.getValues(at(field))), {
          shouldDirty: true,
        });
      }
    }
    toast.success(t('widgets.scenario.copied'));
  };

  const listen = (): void => {
    const url = form.getValues(at('sound.url')) as string | null;
    if (!url) return;
    const audio = new Audio(url);
    audio.volume = Math.min(1, Math.max(0, Number(form.getValues(at('sound.volume'))) || 0));
    void audio.play().catch(() => toast.error(t('widgets.scenario.soundFailed')));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CheckboxField
          form={form}
          name={at('enabled')}
          label={t('widgets.field.scenarioEnabled')}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void test()}
            isLoading={sendTest.isPending}
          >
            {t('widgets.scenario.test')}
          </Button>
          <Button type="button" variant="ghost" onClick={copyDesign}>
            {t('widgets.scenario.copyDesign')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {type === 'donation' ? (
          <MoneyField
            form={form}
            name={at('minAmountMinor')}
            label={t('widgets.field.minAmount')}
            hint={t('widgets.hint.minAmount')}
          />
        ) : null}
        {countLabel ? (
          <NumberField
            form={form}
            name={at('minCount')}
            label={t(countLabel)}
            hint={t('widgets.hint.minCount')}
          />
        ) : null}
        <SelectField
          form={form}
          name={at('layout')}
          label={t('widgets.field.layout')}
          options={LAYOUTS.map((value) => ({ value, label: t(`widgets.layout.${value}`) }))}
        />
        <NumberField
          form={form}
          name={at('durationMs')}
          label={t('widgets.field.durationMs')}
          step={500}
        />
        <SelectField
          form={form}
          name={at('animationIn')}
          label={t('widgets.field.animationIn')}
          options={animationOptions}
        />
        <SelectField
          form={form}
          name={at('animationOut')}
          label={t('widgets.field.animationOut')}
          options={animationOptions}
        />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium">{t('widgets.section.text')}</h3>
        <TextField
          form={form}
          name={at('titleTemplate')}
          label={t('widgets.field.titleTemplate')}
          hint={t('widgets.templateHint', {
            vars: ALERT_TEMPLATE_VARS.map((name) => `{${name}}`).join(', '),
          })}
        />
        <TextField
          form={form}
          name={at('messageTemplate')}
          label={t('widgets.field.messageTemplate')}
        />
        <TextStyleFields form={form} labels={textLabels} withHighlight prefix={prefix} />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium">{t('widgets.section.media')}</h3>
        <TextField
          form={form}
          name={at('imageUrl')}
          label={t('widgets.field.imageUrl')}
          hint={t('widgets.hint.imageUrl')}
          nullable
        />
        <CheckboxField
          form={form}
          name={at('sound.enabled')}
          label={t('widgets.field.soundEnabled')}
        />
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
          <TextField
            form={form}
            name={at('sound.url')}
            label={t('widgets.field.soundUrl')}
            nullable
          />
          <NumberField
            form={form}
            name={at('sound.volume')}
            label={t('widgets.field.volume')}
            step={0.05}
          />
          <Button type="button" variant="secondary" onClick={listen}>
            {t('widgets.scenario.listen')}
          </Button>
        </div>
      </div>
    </div>
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
  // Каналы — только подключённые площадки: вход на площадке доказывает, что
  // канал ваш. Вписать чужой канал больше негде; выбрать можно только, чат
  // каких из своих показывать.
  const channels = useChannels();
  const connected = CHAT_PLATFORMS.map((platform) => ({
    platform,
    channel: channels.data?.find((channel) => channel.platform === platform),
  }));
  const anyConnected = connected.some((item) => item.channel);

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.chat')}</h2>
        {!channels.data ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : !anyConnected ? (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm">
            {t('widgets.chat.none')}{' '}
            <Link to="/analytics" className="underline">
              {t('widgets.chat.connect')}
            </Link>
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="sr-only">{t('widgets.section.chat')}</legend>
            {connected.map(({ platform, channel }) =>
              channel ? (
                <div key={platform} className="space-y-1">
                  <CheckboxField
                    form={form}
                    name={`platforms.${platform}`}
                    label={
                      platform === 'twitch'
                        ? t('widgets.chat.platformTwitch', { channel: channel.login })
                        : t('widgets.chat.platformYoutube', { channel: channel.displayName })
                    }
                  />
                  {platform === 'youtube' ? (
                    <p className="pl-6 text-xs text-muted">{t('widgets.chat.youtubeHint')}</p>
                  ) : null}
                </div>
              ) : (
                <p key={platform} className="text-sm text-muted">
                  {t('widgets.chat.notConnected', {
                    platform: platform === 'twitch' ? 'Twitch' : 'YouTube',
                  })}{' '}
                  <Link to="/analytics" className="underline hover:text-fg">
                    {t('widgets.chat.connect')}
                  </Link>
                </p>
              ),
            )}
          </fieldset>
        )}
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
          <CheckboxField form={form} name="showPlatform" label={t('widgets.field.showPlatform')} />
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
  const rooms = useRooms();
  const roomId = String(form.watch('roomId') ?? '');
  // Удаление комнаты не трогает виджеты, которые на неё ссылаются: в конфиге
  // остаётся идентификатор, которого среди комнат уже нет. Такой виджет так же
  // молча пуст в OBS, как виджет без комнаты, — и предупреждать надо так же.
  const roomDeleted = Boolean(roomId) && !rooms.data?.some((room) => room.id === roomId);

  return (
    <>
      <Card className="space-y-4">
        <h2 className="font-medium">{t('widgets.section.guests')}</h2>
        {/* Предупреждение прямо у поля, а не в документации: ссылка OBS этого
            виджета открывает видео приватной комнаты, и хранить её надо как пароль. */}
        {/* Поле монтируется только со списком комнат. Выпадающий список,
            зарегистрированный раньше своих вариантов, получает значение, которого
            среди них нет, браузер сбрасывает его в пустое — и «Сохранить»
            молча отвязывала бы виджет от комнаты. */}
        {rooms.data ? (
          <div>
            <SelectField
              form={form}
              name="roomId"
              label={t('widgets.field.room')}
              options={[
                { value: '', label: t('widgets.roomNotSelected') },
                ...rooms.data.map((room) => ({ value: room.id, label: room.name })),
              ]}
            />
            <p className="mt-1 text-xs text-muted">
              {rooms.data.length === 0 ? t('widgets.hint.noRooms') : t('widgets.hint.room')}
            </p>
            {/* Без комнаты оверлей подключается, отмечает активность и молча
                остаётся пустым, а предпросмотр рядом показывает примеры гостей.
                Снаружи это неотличимо от поломки — так и было в первой ручной
                проверке, — поэтому пустое поле подсвечено прямо здесь. */}
            {!roomId || roomDeleted ? (
              <p
                role="alert"
                className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm"
              >
                {t(roomDeleted ? 'widgets.hint.roomDeleted' : 'widgets.hint.roomMissing')}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        )}
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
