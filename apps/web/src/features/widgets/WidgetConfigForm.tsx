import {
  ALERT_ANIMATIONS,
  ALERT_EVENT_TYPES,
  ALERT_SOUND_SOURCES,
  ALERT_TEMPLATE_VARS,
  BASIC_ALERT_ANIMATIONS,
  type AlertEventType,
  CHAT_PLATFORMS,
  CURRENCIES,
  type WidgetState,
  GUEST_LAYOUTS,
  isVideoUrl,
  LATEST_DEFAULT_TEMPLATES,
  MAX_GUESTS_PER_ROOM,
  MAX_VERTICAL_SECTORS,
  maxRouletteSectors,
  ROULETTE_MODES,
  type RouletteMode,
  TOP_DONORS_PERIODS,
  type WidgetType,
} from '@streamkit/contracts';
import type { FieldErrors, FieldValues, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, cn, Label, selectClasses } from '@streamkit/app-kit';
import { toast } from 'sonner';
import { PLATFORM_TITLES } from '@streamkit/ui';
import { useChannels } from '@/features/analytics/queries';
import { PlanPaywall, usePlanAccess } from '@/features/billing/PlanPaywall';
import { useRooms } from '@/features/rooms/queries';
import { ApiError } from '@/lib/api';
import { useSendTestAlert } from './queries';
import { useAlertScenarios } from './useAlertScenarios';
import { LayoutSection, StyleSection } from './AdvancedStyling';
import { AlertTriggers, conditionSummary, triggerTitle } from './AlertTriggers';
import { RouletteSectors } from './RouletteSectors';
import { GuestSeatsCanvas } from './GuestSeatsCanvas';
import { canvasOf, WidgetSurface } from './WidgetPreview';
import {
  CheckboxField,
  CheckboxGroupField,
  ColorField,
  MoneyField,
  NumberField,
  RangeField,
  SelectField,
  TagsField,
  TextField,
  TextStyleFields,
} from './fields';
import { PLATFORMS_PATH } from '@/components/navigation';

const LAYOUTS = ['center', 'banner', 'side'] as const;

/* ------------------------------------------------------------------ */
/* Разделы                                                             */
/* ------------------------------------------------------------------ */

export type SectionId =
  'main' | 'show' | 'text' | 'media' | 'lines' | 'look' | 'layout' | 'style' | 'triggers' | 'spin';

interface SectionDef {
  id: SectionId;
  /** Ключ подписи вкладки. */
  label: string;
  /**
   * Поля раздела — верхний уровень конфига (у оповещений — сценария). По ним
   * вкладка узнаёт свои ошибки: поле с ошибкой в закрытом разделе иначе не
   * увидеть, и «Сохранить» выглядела бы сломанной.
   */
  fields: readonly string[];
  /** Раздел продвинутого оформления — помечен «Про». */
  pro?: boolean;
}

const LAYOUT_SECTION: SectionDef = {
  id: 'layout',
  label: 'widgets.tab.layout',
  fields: ['slots'],
  pro: true,
};
const STYLE_SECTION: SectionDef = {
  id: 'style',
  label: 'widgets.tab.style',
  fields: ['background', 'barImageUrl', 'trackImageUrl'],
  pro: true,
};

/**
 * Разделы формы по типу виджета.
 *
 * Раньше настройки шли одной формой на несколько экранов: кнопка «Сохранить» —
 * в самом низу, а предпросмотр уезжал вверх, как только начинаешь править
 * нижние поля. Разделы короткие, каждый помещается на экран рядом с
 * предпросмотром, а порядок вкладок — порядок настройки: что показывать, как
 * выглядит текст, где стоит в кадре.
 */
export function sectionsFor(
  type: WidgetType,
  scenario: AlertEventType = 'donation',
  /**
   * Правят вид триггера. Тогда вкладки настраивают ЕГО, и списка триггеров
   * среди них нет: вкладка, которая правит совсем другой объект, стояла бы в
   * одном ряду с теми, что правят триггер. Обратно — шапкой над вкладками.
   */
  editingTrigger = false,
): readonly SectionDef[] {
  switch (type) {
    case 'alerts':
      return [
        {
          id: 'show',
          label: 'widgets.tab.show',
          fields: [
            'enabled',
            'minAmounts',
            'minCount',
            'layout',
            'durationMs',
            'animationIn',
            'animationOut',
          ],
        },
        // Триггеры — только у доната: сумма есть только у него. Сразу после
        // «Показа», до вида: от них зависит, ЧЕЙ вид правят следующие вкладки.
        ...(scenario === 'donation' && !editingTrigger
          ? [{ id: 'triggers', label: 'widgets.tab.triggers', fields: ['triggers'] } as const]
          : []),
        {
          id: 'text',
          label: 'widgets.tab.text',
          fields: ['titleTemplate', 'messageTemplate', 'text'],
        },
        { id: 'media', label: 'widgets.tab.media', fields: ['imageUrl', 'sound'] },
        LAYOUT_SECTION,
        STYLE_SECTION,
      ];
    case 'goal':
      return [
        {
          id: 'main',
          label: 'widgets.tab.goal',
          fields: ['title', 'targetMinor', 'startedAt', 'countTypes', 'showAmounts'],
        },
        { id: 'look', label: 'widgets.tab.look', fields: ['barColor', 'trackColor', 'text'] },
        LAYOUT_SECTION,
        STYLE_SECTION,
      ];
    case 'timer':
      return [
        {
          id: 'main',
          label: 'widgets.tab.timer',
          fields: [
            'title',
            'initialSeconds',
            'maxSeconds',
            'secondsPerUnit',
            'countTypes',
            'showHours',
          ],
        },
        { id: 'look', label: 'widgets.tab.text', fields: ['text'] },
        LAYOUT_SECTION,
        STYLE_SECTION,
      ];
    case 'top-donors':
      return [
        {
          id: 'main',
          label: 'widgets.tab.topDonors',
          fields: ['title', 'period', 'limit', 'showAmounts'],
        },
        { id: 'look', label: 'widgets.tab.text', fields: ['text'] },
        LAYOUT_SECTION,
        STYLE_SECTION,
      ];
    case 'chat':
      return [
        {
          id: 'main',
          label: 'widgets.tab.channels',
          fields: ['platforms', 'hiddenUsers', 'hideCommands'],
        },
        {
          id: 'lines',
          label: 'widgets.tab.lines',
          fields: [
            'maxMessages',
            'messageLifetimeSeconds',
            'newestFirst',
            'showBadges',
            'showPlatform',
            'showEmotes',
            'useAuthorColors',
          ],
        },
        { id: 'look', label: 'widgets.tab.text', fields: ['text'] },
        STYLE_SECTION,
      ];
    case 'guests':
      return [
        {
          id: 'main',
          label: 'widgets.tab.room',
          fields: ['roomId', 'cornerRadius', 'showNames', 'showWithoutVideo'],
        },
        // Раскладка гостей — без пометки «Про»: без тарифа комнаты не работают
        // вовсе, и помечать внутри них «платное» было бы пустым словом.
        {
          id: 'layout',
          label: 'widgets.tab.layout',
          fields: ['layout', 'maxTiles', 'gap', 'seats'],
        },
        { id: 'look', label: 'widgets.tab.text', fields: ['text'] },
        // У гостей из продвинутого — только шрифт имён: фона и раскладки нет.
        { ...STYLE_SECTION, label: 'widgets.tab.font' },
      ];
    case 'latest':
      return [
        {
          id: 'main',
          label: 'widgets.tab.latest',
          fields: ['eventType', 'title', 'template', 'showMessage', 'emptyText'],
        },
        { id: 'look', label: 'widgets.tab.text', fields: ['text'] },
        LAYOUT_SECTION,
        STYLE_SECTION,
      ];
    case 'roulette':
      return [
        { id: 'main', label: 'widgets.tab.sectors', fields: ['sectors'] },
        {
          id: 'spin',
          label: 'widgets.tab.spin',
          fields: [
            'title',
            'donationSpins',
            'spinPrice',
            'spinDurationMs',
            'resultMs',
            'hideWhenIdle',
            'showDonor',
          ],
        },
        { id: 'look', label: 'widgets.tab.wheel', fields: ['wheelSize', 'rimColor', 'text'] },
        LAYOUT_SECTION,
        STYLE_SECTION,
      ];
  }
}

/** Где первая ошибка формы: в каком сценарии и разделе. null — ошибок нет. */
export function locateError(
  type: WidgetType,
  errors: FieldErrors<FieldValues>,
): { scenario?: AlertEventType; section: SectionId } | null {
  const sectionOf = (
    tree: Record<string, unknown>,
    scenario: AlertEventType = 'donation',
  ): SectionId | null =>
    sectionsFor(type, scenario).find((section) => section.fields.some((field) => tree[field]))
      ?.id ?? null;

  if (type === 'alerts') {
    // Пауза и голосовые донаты — общие настройки, живут в разделе «Показ».
    if (errors.gapMs || errors.voice) return { section: 'show' };
    const scenarios = (errors.scenarios ?? {}) as Record<string, Record<string, unknown>>;
    for (const scenario of ALERT_EVENT_TYPES) {
      const tree = scenarios[scenario];
      if (!tree) continue;
      return { scenario, section: sectionOf(tree, scenario) ?? 'show' };
    }
    return null;
  }
  const sections = sectionsFor(type);
  const section = sectionOf(errors as Record<string, unknown>);
  return section
    ? { section }
    : Object.keys(errors).length > 0
      ? { section: sections[0]!.id }
      : null;
}

/**
 * Форма настроек под тип виджета.
 *
 * Одна точка ветвления вместо шести страниц: общая обвязка редактора (имя,
 * ссылки OBS, предпросмотр, кнопка сохранения) у всех типов одна, различается
 * только набор разделов и полей.
 *
 * Поля закрытых разделов форма держит сама (`shouldUnregister` выключен) и
 * сохраняет все разом — вкладка меняет только то, что на экране.
 */
export function WidgetConfigForm({
  type,
  form,
  section,
  onSectionChange,
  alertScenario,
  onAlertScenarioChange,
  alertTrigger = null,
  onAlertTriggerChange,
  currency,
  state,
}: {
  type: WidgetType;
  form: UseFormReturn<FieldValues>;
  /** Состояние виджета — для рендера под ручками раскладки. */
  state: WidgetState | null;
  /** Основная валюта донатов — из состояния виджета, а не из настроек. */
  currency: string;
  section: SectionId;
  onSectionChange: (section: SectionId) => void;
  /** Открытый сценарий оповещений — его же показывает предпросмотр. */
  alertScenario: AlertEventType;
  onAlertScenarioChange: (scenario: AlertEventType) => void;
  /** Триггер, чей вид правят разделы; null — вид самого сценария. */
  alertTrigger?: string | null;
  onAlertTriggerChange?: (trigger: string | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const sections = sectionsFor(type, alertScenario, alertTrigger !== null);
  const current = sections.find((item) => item.id === section) ?? sections[0]!;
  const triggers = (
    type === 'alerts' ? (form.watch(`scenarios.${alertScenario}.triggers`) ?? []) : []
  ) as { id: string; name: string; condition: Parameters<typeof conditionSummary>[1] }[];
  const triggerIndex = alertTrigger ? triggers.findIndex((item) => item.id === alertTrigger) : -1;
  const trigger = triggerIndex === -1 ? null : triggers[triggerIndex]!;
  // Разделы вида правят либо сам сценарий, либо выбранный триггер: путь в форме
  // отличается только префиксом, а поля те же.
  const scenarioPrefix = `scenarios.${alertScenario}.`;
  const prefix =
    type !== 'alerts'
      ? ''
      : trigger
        ? `${scenarioPrefix}triggers.${triggerIndex}.`
        : scenarioPrefix;
  const errorTree = (
    type === 'alerts'
      ? prefix
          .slice(0, -1)
          .split('.')
          .reduce<unknown>(
            (node, key) => (node as Record<string, unknown> | undefined)?.[key],
            form.formState.errors,
          )
      : form.formState.errors
  ) as Record<string, unknown> | undefined;

  // Взялись за вид — сразу к нему: список триггеров вид не показывает.
  const editTrigger = (id: string): void => {
    onAlertTriggerChange?.(id);
    onSectionChange('show');
  };

  // Из вида триггера — к списку, и выбор при этом снимается: пока триггер
  // выбран, вкладки правят его, а не основной вид. Значит выйти из триггера и
  // вернуться к списку — одно и то же действие, и двух кнопок для него не надо.
  const leaveTrigger = (): void => {
    onAlertTriggerChange?.(null);
    onSectionChange('triggers');
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-card border bg-surface',
        // Правится не основной вид — это видно по рамке всей формы, а не только
        // по подписи в шапке: поля у триггера и у сценария одни и те же.
        trigger ? 'border-accent/60' : 'border-border',
      )}
    >
      {type === 'alerts' ? (
        <ScenarioHeader form={form} selected={alertScenario} onSelect={onAlertScenarioChange} />
      ) : null}

      {/* Чей вид правят разделы — словом над вкладками: одинаковые поля у
          сценария и триггера иначе неотличимы, и правка ушла бы не туда. */}
      {trigger ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-hover/50 px-5 py-3 sm:px-6">
          <p className="text-sm">
            <span className="text-muted">{t('widgets.triggers.editingBanner')} </span>
            <span className="font-medium">{triggerTitle(t, triggerIndex, trigger)}</span>
          </p>
          <Button variant="ghost" onClick={leaveTrigger}>
            <span aria-hidden="true">← </span>
            {t('widgets.triggers.backToList')}
          </Button>
        </div>
      ) : null}

      <SectionTabs
        sections={sections}
        current={current.id}
        onSelect={onSectionChange}
        hasError={(item) =>
          item.fields.some((field) => errorTree?.[field]) ||
          (type === 'alerts' &&
            item.id === 'show' &&
            Boolean(form.formState.errors.gapMs || form.formState.errors.voice))
        }
      />

      <div
        key={`${prefix}${current.id}`}
        role="tabpanel"
        id={`section-panel-${current.id}`}
        aria-labelledby={`section-tab-${current.id}`}
        className="p-5 sm:p-6"
      >
        {current.id === 'triggers' ? (
          <AlertTriggers form={form} scenario={alertScenario} onEdit={editTrigger} />
        ) : (
          <SectionBody
            type={type}
            form={form}
            section={current.id}
            scenario={alertScenario}
            trigger={trigger ? trigger.id : null}
            prefix={prefix}
            currency={currency}
            state={state}
          />
        )}
      </div>

      {type === 'alerts' ? (
        <p className="border-t border-border px-5 py-3 text-xs text-muted sm:px-6">
          {t('widgets.scenario.hint')}
        </p>
      ) : null}
    </div>
  );
}

function SectionBody({
  type,
  form,
  section,
  scenario,
  trigger,
  prefix,
  currency,
  state,
}: {
  type: WidgetType;
  form: UseFormReturn<FieldValues>;
  section: SectionId;
  scenario: AlertEventType;
  trigger: string | null;
  prefix: string;
  currency: string;
  state: WidgetState | null;
}): React.JSX.Element | null {
  if (section === 'layout' && type === 'guests') return <GuestsLayout form={form} />;
  if (section === 'layout')
    return (
      <LayoutSection
        form={form}
        type={type}
        prefix={prefix}
        scenario={scenario}
        trigger={trigger}
        state={state}
      />
    );
  if (section === 'style') return <StyleSection form={form} type={type} prefix={prefix} />;

  switch (type) {
    case 'alerts':
      return (
        <AlertSection
          form={form}
          section={section}
          scenario={scenario}
          prefix={prefix}
          isTrigger={trigger !== null}
        />
      );
    case 'goal':
      return section === 'look' ? (
        <GoalLook form={form} />
      ) : (
        <GoalMain form={form} currency={currency} />
      );
    case 'timer':
      return section === 'look' ? (
        <TextSection form={form} />
      ) : (
        <TimerMain form={form} currency={currency} />
      );
    case 'top-donors':
      return section === 'look' ? (
        <TextSection form={form} />
      ) : (
        <TopDonorsMain form={form} currency={currency} />
      );
    case 'chat':
      if (section === 'lines') return <ChatLines form={form} />;
      return section === 'look' ? (
        <TextSection form={form} withHighlight />
      ) : (
        <ChatMain form={form} />
      );
    case 'guests':
      return section === 'look' ? <TextSection form={form} /> : <GuestsMain form={form} />;
    case 'latest':
      return section === 'look' ? (
        <TextSection form={form} withHighlight />
      ) : (
        <LatestMain form={form} />
      );
    case 'roulette':
      if (section === 'spin') return <RouletteSpinSettings form={form} />;
      return section === 'look' ? (
        <RouletteLook form={form} />
      ) : (
        <RouletteSectorsSection form={form} />
      );
  }
}

/**
 * Вкладки разделов.
 *
 * Подчёркнутые, а не «таблетки», как у сценариев: сценарий — это ЧТО правим
 * (донат или фолловер), раздел — КАКУЮ сторону его. Один вид для обоих уровней
 * сливал бы их в одну строку кнопок.
 */
function SectionTabs({
  sections,
  current,
  onSelect,
  hasError,
}: {
  sections: readonly SectionDef[];
  current: SectionId;
  onSelect: (section: SectionId) => void;
  hasError: (section: SectionDef) => boolean;
}): React.JSX.Element {
  const { t } = useTranslation();

  // Стрелки двигают выбор по кругу — как у любых вкладок (WAI-ARIA Tabs).
  const move = (from: SectionId, step: number): void => {
    const index = sections.findIndex((item) => item.id === from);
    const next = sections[(index + step + sections.length) % sections.length]!;
    onSelect(next.id);
    document.getElementById(`section-tab-${next.id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t('widgets.tab.label')}
      // Прокрутка только вбок: `overflow-x` в одиночку делает вторую ось
      // `auto`, и появившаяся снизу полоса тут же отнимала высоту у ленты —
      // рядом вырастала вертикальная полоса, которой нечего прокручивать.
      className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-3 sm:px-4"
    >
      {sections.map((item) => {
        const active = item.id === current;
        const error = hasError(item);
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`section-tab-${item.id}`}
            aria-selected={active}
            aria-controls={`section-panel-${item.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') move(item.id, 1);
              if (event.key === 'ArrowLeft') move(item.id, -1);
            }}
            className={cn(
              // Без перехода цвета: вкладки щёлкают десятки раз за настройку, и
              // запаздывающее подчёркивание читается как задержка ответа.
              'relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm whitespace-nowrap',
              active
                ? 'border-accent font-medium text-fg'
                : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t(item.label)}
            {item.pro ? (
              <span
                // Нейтральная метка: жёлтый — только у действий, а «Про» — не кнопка.
                className="rounded border border-border-strong px-1 py-px text-[10px] font-semibold tracking-wide text-muted uppercase"
              >
                {t('widgets.tab.pro')}
              </span>
            ) : null}
            {error ? (
              <>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-danger" />
                <span className="sr-only">, {t('widgets.tab.hasError')}</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Оповещения                                                          */
/* ------------------------------------------------------------------ */

/** Порог количества — там, где количество у события есть. У доната порог — сумма. */
const COUNT_THRESHOLDS: Partial<Record<AlertEventType, string>> = {
  gift: 'widgets.field.minGifts',
  resubscription: 'widgets.field.minMonths',
  cheer: 'widgets.field.minBits',
  kicks: 'widgets.field.minKicks',
  raid: 'widgets.field.minRaiders',
};

/**
 * Что копирует «оформление в остальные сценарии»: вид и медиа, но не тексты и
 * пороги — они у каждого события свои по смыслу.
 *
 * Продвинутое оформление копируется тоже — раскладка и фон это и есть вид, и
 * расставлять элементы заново в каждом из восьми сценариев никто не станет.
 * Картинка — тоже вид: без неё копия раскладки ставила ширину и место картинке,
 * которой в других сценариях нет. Звук идёт вместе с картинкой: при звуке из
 * видео это одна дорожка, и половинчатая копия оставила бы сценарий с видео,
 * но без его звука. Разный звук на разные события стример поставит после копии.
 */
const DESIGN_FIELDS = [
  'imageUrl',
  'sound',
  'layout',
  'durationMs',
  'animationIn',
  'animationOut',
  'text',
  'slots',
  'background',
] as const;

/**
 * Шапка оповещений: выбор сценария и то, что относится к нему целиком, —
 * включён ли он, проверка в OBS и копирование оформления. Всё это стоит над
 * разделами, потому что действует на сценарий, а не на один раздел.
 */
function ScenarioHeader({
  form,
  selected,
  onSelect,
}: {
  form: UseFormReturn<FieldValues>;
  selected: AlertEventType;
  onSelect: (scenario: AlertEventType) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const sendTest = useSendTestAlert();
  // Сценарии площадок, которых нет, не показываются: оповещение о рейде без
  // Twitch никогда не сработает. Их настройки остаются в конфиге.
  const { scenarios: available } = useAlertScenarios();
  const scenarios = (form.watch('scenarios') ?? {}) as Partial<
    Record<AlertEventType, { enabled?: boolean }>
  >;

  // Стрелки двигают выбор по кругу — как у любых вкладок (WAI-ARIA Tabs).
  const move = (from: AlertEventType, step: number): void => {
    const count = available.length;
    const next = available[(available.indexOf(from) + step + count) % count]!;
    onSelect(next);
    document.getElementById(`scenario-tab-${next}`)?.focus();
  };

  const test = async (): Promise<void> => {
    try {
      await sendTest.mutateAsync(selected);
      toast.success(t('widgets.scenario.testSent'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  };

  // Копия уходит в форму, а не на сервер: до «Сохранить» её можно отменить.
  const copyDesign = (): void => {
    for (const other of ALERT_EVENT_TYPES) {
      if (other === selected) continue;
      for (const field of DESIGN_FIELDS) {
        form.setValue(
          `scenarios.${other}.${field}`,
          structuredClone(form.getValues(`scenarios.${selected}.${field}`)),
          { shouldDirty: true },
        );
      }
    }
    toast.success(t('widgets.scenario.copied'));
  };

  return (
    <div className="space-y-4 border-b border-border p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-medium">{t('widgets.scenario.title')}</h2>
      </div>
      {/* Выключенный сценарий зачёркнут и подписан словом для экранного
          диктора: его видно не только по цвету. */}
      <div
        role="tablist"
        aria-label={t('widgets.scenario.title')}
        className="flex flex-wrap gap-1.5"
      >
        {available.map((type) => {
          const active = type === selected;
          const enabled = scenarios[type]?.enabled !== false;
          return (
            <button
              key={type}
              type="button"
              role="tab"
              id={`scenario-tab-${type}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(type)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') move(type, 1);
                if (event.key === 'ArrowLeft') move(type, -1);
              }}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm',
                active
                  ? 'border-fg bg-fg font-medium text-bg'
                  : 'border-border text-muted hover:border-border-strong hover:text-fg',
                !enabled && 'line-through decoration-2',
              )}
            >
              {t(`events.type.${type}`)}
              {enabled ? null : <span className="sr-only">, {t('widgets.scenario.off')}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-bg/50 px-3 py-2">
        <CheckboxField
          key={selected}
          form={form}
          name={`scenarios.${selected}.enabled`}
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
    </div>
  );
}

/**
 * Порог показа доната — по валютам.
 *
 * Единственная настройка оповещений, которая знает о валюте: донат сравнивается
 * с порогом своей валюты как пришёл, без пересчёта по курсу. Поля — на все
 * валюты сразу, а не «добавить валюту»: их шесть, и пустое поле честно читается
 * как «порога нет».
 */
function DonationThresholds({
  form,
  prefix,
}: {
  form: UseFormReturn<FieldValues>;
  prefix: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <fieldset className="sm:col-span-2" aria-describedby="min-amounts-hint">
      <legend className="text-sm font-medium text-muted">{t('widgets.field.minAmount')}</legend>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CURRENCIES.map((currency) => (
          <MoneyField
            key={currency}
            form={form}
            name={`${prefix}minAmounts.${currency}`}
            label={currency}
            currency={currency}
            emptyValue={0}
          />
        ))}
      </div>
      <p id="min-amounts-hint" className="mt-2 text-xs text-muted">
        {t('widgets.hint.minAmount')}
      </p>
    </fieldset>
  );
}

function AlertSection({
  form,
  section,
  scenario,
  prefix,
  isTrigger,
}: {
  form: UseFormReturn<FieldValues>;
  section: SectionId;
  scenario: AlertEventType;
  /** Путь до вида: сценарий или его триггер. */
  prefix: string;
  /** Правят вид триггера: порогов и общей паузы у него нет. */
  isTrigger: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const at = (field: string): string => `${prefix}${field}`;
  const textLabels = useTextLabels();
  const countLabel = COUNT_THRESHOLDS[scenario];
  // Без «Про» в списке только базовые анимации: показывать выбор, который сервер
  // всё равно заменит базовым, хуже, чем не показывать его вовсе.
  const advanced = usePlanAccess('advancedStyling');
  const animationOptions = (advanced ? ALERT_ANIMATIONS : BASIC_ALERT_ANIMATIONS).map((value) => ({
    value,
    label: t(`widgets.animation.${value}`),
  }));

  const imageUrl = form.watch(at('imageUrl')) as string | null;
  // Выбор источника звука — только когда картинка сценария — видео WebM: у
  // картинки звуковой дорожки нет, и выбирать там не из чего.
  const videoImage = Boolean(imageUrl && isVideoUrl(imageUrl));
  const fromVideo = videoImage && form.watch(at('sound.source')) === 'video';

  const listen = (): void => {
    // «Прослушать» звук из видео — той же дорожкой того же файла: плеер аудио
    // играет звук из WebM и без картинки.
    const url = fromVideo ? imageUrl : (form.getValues(at('sound.url')) as string | null);
    if (!url) return;
    const audio = new Audio(url);
    audio.volume = Math.min(1, Math.max(0, Number(form.getValues(at('sound.volume'))) || 0));
    void audio.play().catch(() => toast.error(t('widgets.scenario.soundFailed')));
  };

  if (section === 'text') {
    return (
      <div className="space-y-5">
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
        <div className="border-t border-border pt-5">
          <TextStyleFields form={form} labels={textLabels} withHighlight prefix={prefix} />
        </div>
      </div>
    );
  }

  if (section === 'media') {
    return (
      <div className="space-y-5">
        <TextField
          form={form}
          name={at('imageUrl')}
          label={t('widgets.field.imageUrl')}
          hint={t('widgets.hint.imageUrl')}
          nullable
        />
        <div className="space-y-5 border-t border-border pt-5">
          <CheckboxField
            form={form}
            name={at('sound.enabled')}
            label={t('widgets.field.soundEnabled')}
          />
          {videoImage ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t('widgets.field.soundSource')}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ALERT_SOUND_SOURCES.map((source) => (
                  <label
                    key={source}
                    className="flex items-start gap-2 rounded-lg border border-border-strong p-3 text-sm has-[:checked]:border-fg has-[:checked]:bg-surface-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
                  >
                    <input
                      type="radio"
                      value={source}
                      className="mt-0.5 h-4 w-4 shrink-0"
                      {...form.register(at('sound.source'))}
                    />
                    <span>
                      <span className="block font-medium">
                        {t(`widgets.soundSource.${source}.title`)}
                      </span>
                      <span className="block text-xs text-muted">
                        {t(`widgets.soundSource.${source}.hint`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            {/* Поле файла прячется, а не выключается: значение в нём остаётся и
                вернётся, если стример снова выберет отдельный файл. */}
            {fromVideo ? (
              <p className="text-sm text-muted">{t('widgets.hint.soundFromVideo')}</p>
            ) : (
              <TextField
                form={form}
                name={at('sound.url')}
                label={t('widgets.field.soundUrl')}
                nullable
              />
            )}
            <Button type="button" variant="secondary" onClick={listen}>
              {t('widgets.scenario.listen')}
            </Button>
          </div>
          <RangeField
            form={form}
            name={at('sound.volume')}
            label={t('widgets.field.volume')}
            min={0}
            max={100}
            scale={100}
            unit="%"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!isTrigger && (scenario === 'donation' || countLabel) ? (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {scenario === 'donation' ? <DonationThresholds form={form} prefix={prefix} /> : null}
          {countLabel ? (
            <NumberField
              form={form}
              name={at('minCount')}
              label={t(countLabel)}
              hint={t('widgets.hint.minCount')}
            />
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <SelectField
          form={form}
          name={at('layout')}
          label={t('widgets.field.layout')}
          options={LAYOUTS.map((value) => ({ value, label: t(`widgets.layout.${value}`) }))}
        />
        {/* Секунды, а не миллисекунды: «6000» никто не читает как шесть секунд. */}
        <RangeField
          form={form}
          name={at('durationMs')}
          label={t('widgets.field.durationMs')}
          min={1}
          max={60}
          step={0.5}
          scale={0.001}
          unit={t('widgets.unit.seconds')}
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

      {/* Пауза — одна на все сценарии: очередь у виджета общая. Живёт здесь,
          потому что это тоже «как показывать», но подписана как общая. */}
      <div className={cn('space-y-4 border-t border-border pt-5', isTrigger && 'hidden')}>
        <h3 className="text-sm font-medium">{t('widgets.section.allScenarios')}</h3>
        <RangeField
          form={form}
          name="gapMs"
          label={t('widgets.field.gapMs')}
          min={0}
          max={10}
          step={0.1}
          scale={0.001}
          unit={t('widgets.unit.seconds')}
          hint={t('widgets.hint.gapMs')}
        />
        <VoiceSettings form={form} />
      </div>
    </div>
  );
}

/**
 * События YouTube: спонсорства и платная поддержка.
 *
 * Настройка виджета, а не сценария, поэтому стоит рядом с предпросмотром, а не
 * в разделах: в разделах она повторялась бы в каждом сценарии и выглядела бы
 * настройкой доната или фолловера по отдельности.
 *
 * Отдельная настройка, а не «включено всегда»: у YouTube нет подписки на
 * события, они приходят строками потока чата эфира, а его открытие стоит квоты,
 * общей на весь сервис. И приходят, только пока оверлей этого виджета открыт в
 * OBS, — сказать об этом нужно прямо, иначе «оповещения о спонсорах не
 * работают» выглядит поломкой.
 */
export function YouTubeEvents({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t('widgets.section.youtubeEvents')}</h3>
      <CheckboxField form={form} name="youtubeEvents" label={t('widgets.field.youtubeEvents')} />
      <p className="max-w-prose text-xs text-muted">{t('widgets.hint.youtubeEvents')}</p>
    </div>
  );
}

/**
 * Голосовые донаты: запись донатера играет вместе с его оповещением.
 *
 * Настройка на весь виджет, а не на сценарий: голос приходит с донатом как
 * есть. Потолок обязателен — длину записи задаёт донатер, и без него минутная
 * тирада держала бы очередь оповещений столько, сколько захочет чужой человек.
 */
function VoiceSettings({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const enabled = form.watch('voice.enabled') !== false;

  return (
    <div className="space-y-4">
      <CheckboxField form={form} name="voice.enabled" label={t('widgets.field.voiceEnabled')} />
      {enabled ? (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <RangeField
            form={form}
            name="voice.volume"
            label={t('widgets.field.voiceVolume')}
            min={0}
            max={100}
            scale={100}
            unit="%"
          />
          <RangeField
            form={form}
            name="voice.maxSeconds"
            label={t('widgets.field.voiceMaxSeconds')}
            min={5}
            max={300}
            step={5}
            unit={t('widgets.unit.seconds')}
            hint={t('widgets.hint.voiceMaxSeconds')}
          />
        </div>
      ) : null}
      <p className="text-xs text-muted">{t('widgets.hint.voice')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Цель, таймер, топ                                                   */
/* ------------------------------------------------------------------ */

function useTextLabels() {
  const { t } = useTranslation();
  return {
    fontSize: t('widgets.field.fontSize'),
    strokeWidth: t('widgets.field.strokeWidth'),
    color: t('widgets.field.color'),
    highlightColor: t('widgets.field.highlightColor'),
  };
}

function TextSection({
  form,
  withHighlight = false,
}: {
  form: UseFormReturn<FieldValues>;
  withHighlight?: boolean;
}): React.JSX.Element {
  const labels = useTextLabels();
  return <TextStyleFields form={form} labels={labels} withHighlight={withHighlight} />;
}

function eventTypeOptions(t: (key: string) => string) {
  return ALERT_EVENT_TYPES.map((value) => ({ value, label: t(`events.type.${value}`) }));
}

/**
 * Валюта виджета — та, в которой приходят донаты. Её не выбирают: сервер берёт
 * основную валюту донатов владельца и отдаёт её в состоянии. Подсказка
 * называет её прямо, чтобы стример знал, в чём вводить цель.
 */
function CurrencyNote({ currency }: { currency: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <p className="text-xs text-muted">{t('widgets.hint.currencyFromDonations', { currency })}</p>
  );
}

function GoalMain({ form, currency }: MainProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <TextField form={form} name="title" label={t('widgets.field.goalTitle')} />
      <div className="space-y-1.5">
        <div className="max-w-xs">
          <MoneyField
            form={form}
            name="targetMinor"
            label={t('widgets.field.targetMinor')}
            currency={currency}
          />
        </div>
        <CurrencyNote currency={currency} />
      </div>
      <CheckboxGroupField
        form={form}
        name="countTypes"
        label={t('widgets.field.countTypes')}
        options={eventTypeOptions(t)}
        hint={t('widgets.hint.countTypes')}
      />
      <CheckboxField form={form} name="showAmounts" label={t('widgets.field.showAmounts')} />
    </div>
  );
}

function GoalLook({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const textLabels = useTextLabels();
  return (
    <div className="space-y-6">
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <ColorField form={form} name="barColor" label={t('widgets.field.barColor')} />
        <ColorField form={form} name="trackColor" label={t('widgets.field.trackColor')} />
      </div>
      <div className="border-t border-border pt-5">
        <TextStyleFields form={form} labels={textLabels} />
      </div>
    </div>
  );
}

function TimerMain({ form, currency }: MainProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <TextField form={form} name="title" label={t('widgets.field.timerTitle')} />
      {/* Числа, а не ползунки: длительность марафона задают точно, до минуты,
          на шкале в сутки ползунок так не умеет. */}
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
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
      </div>
      <CurrencyNote currency={currency} />
      <CheckboxGroupField
        form={form}
        name="countTypes"
        label={t('widgets.field.countTypes')}
        options={eventTypeOptions(t)}
        hint={t('widgets.hint.countTypes')}
      />
      <CheckboxField form={form} name="showHours" label={t('widgets.field.showHours')} />
    </div>
  );
}

interface MainProps {
  form: UseFormReturn<FieldValues>;
  currency: string;
}

function TopDonorsMain({ form, currency }: MainProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <TextField form={form} name="title" label={t('widgets.field.topDonorsTitle')} />
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <SelectField
          form={form}
          name="period"
          label={t('widgets.field.period')}
          options={TOP_DONORS_PERIODS.map((value) => ({
            value,
            label: t(`widgets.period.${value}`),
          }))}
        />
        <RangeField form={form} name="limit" label={t('widgets.field.limit')} min={1} max={10} />
      </div>
      <CurrencyNote currency={currency} />
      <CheckboxField form={form} name="showAmounts" label={t('widgets.field.showAmounts')} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Чат                                                                 */
/* ------------------------------------------------------------------ */

function ChatMain({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
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
    <div className="space-y-6">
      {!channels.data ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : !anyConnected ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
          {t('widgets.chat.none')}{' '}
          <Link to={PLATFORMS_PATH} className="underline">
            {t('widgets.chat.connect')}
          </Link>
        </p>
      ) : (
        <fieldset className="space-y-3">
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
                      : platform === 'kick'
                        ? t('widgets.chat.platformKick', { channel: channel.login })
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
                  platform: PLATFORM_TITLES[platform],
                })}{' '}
                <Link to={PLATFORMS_PATH} className="underline hover:text-fg">
                  {t('widgets.chat.connect')}
                </Link>
              </p>
            ),
          )}
        </fieldset>
      )}
      <div className="space-y-4 border-t border-border pt-5">
        <TagsField
          form={form}
          name="hiddenUsers"
          label={t('widgets.field.hiddenUsers')}
          hint={t('widgets.hint.hiddenUsers')}
        />
        <CheckboxField form={form} name="hideCommands" label={t('widgets.field.hideCommands')} />
      </div>
    </div>
  );
}

function ChatLines({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <RangeField
          form={form}
          name="maxMessages"
          label={t('widgets.field.maxMessages')}
          min={1}
          max={50}
        />
        <RangeField
          form={form}
          name="messageLifetimeSeconds"
          label={t('widgets.field.messageLifetime')}
          min={0}
          max={600}
          step={5}
          unit={t('widgets.unit.seconds')}
          zeroLabel={t('widgets.hint.neverFades')}
          hint={t('widgets.hint.messageLifetime')}
        />
      </div>
      <div className="grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
        <CheckboxField form={form} name="newestFirst" label={t('widgets.field.newestFirst')} />
        <CheckboxField form={form} name="showBadges" label={t('widgets.field.showBadges')} />
        <CheckboxField form={form} name="showPlatform" label={t('widgets.field.showPlatform')} />
        <CheckboxField form={form} name="showEmotes" label={t('widgets.field.showEmotes')} />
        <CheckboxField
          form={form}
          name="useAuthorColors"
          label={t('widgets.field.useAuthorColors')}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Гости                                                               */
/* ------------------------------------------------------------------ */

function GuestsMain({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const rooms = useRooms();
  const roomId = String(form.watch('roomId') ?? '');
  // Удаление комнаты не трогает виджеты, которые на неё ссылаются: в конфиге
  // остаётся идентификатор, которого среди комнат уже нет. Такой виджет так же
  // молча пуст в OBS, как виджет без комнаты, — и предупреждать надо так же.
  const roomDeleted = Boolean(roomId) && !rooms.data?.some((room) => room.id === roomId);

  return (
    <div className="space-y-6">
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
          {/* Предупреждение прямо у поля, а не в документации: ссылка OBS этого
              виджета открывает видео приватной комнаты, и хранить её надо как пароль. */}
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
              className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm"
            >
              {t(roomDeleted ? 'widgets.hint.roomDeleted' : 'widgets.hint.roomMissing')}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      )}
      <div className="grid gap-x-6 gap-y-5 border-t border-border pt-5 sm:grid-cols-2">
        <RangeField
          form={form}
          name="cornerRadius"
          label={t('widgets.field.cornerRadius')}
          min={0}
          max={48}
          unit="px"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CheckboxField form={form} name="showNames" label={t('widgets.field.showNames')} />
        <CheckboxField
          form={form}
          name="showWithoutVideo"
          label={t('widgets.field.showWithoutVideo')}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Последнее событие                                                   */
/* ------------------------------------------------------------------ */

function LatestMain({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();

  // Смена события меняет шаблон и заголовок, только если их не трогали: у
  // фолловера нет суммы, и «{username} — {amount}» оставил бы висящее тире. А
  // свой шаблон стримера смена события не стирает.
  const switchEvent = (next: AlertEventType, previous: AlertEventType): void => {
    if (form.getValues('template') === LATEST_DEFAULT_TEMPLATES[previous]) {
      form.setValue('template', LATEST_DEFAULT_TEMPLATES[next], { shouldDirty: true });
    }
    if (form.getValues('title') === t(`widgets.latestTitle.${previous}`)) {
      form.setValue('title', t(`widgets.latestTitle.${next}`), { shouldDirty: true });
    }
  };
  // Прежнее значение — из этого рендера: обработчик вызывается уже после
  // записи нового, и спрашивать форму поздно.
  const current = form.watch('eventType') as AlertEventType;
  const eventType = form.register('eventType', {
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
      switchEvent(event.target.value as AlertEventType, current),
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="eventType">{t('widgets.field.latestEvent')}</Label>
          <select id="eventType" className={selectClasses} {...eventType}>
            {ALERT_EVENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`events.type.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <TextField form={form} name="title" label={t('widgets.field.latestTitle')} />
      </div>
      <TextField
        form={form}
        name="template"
        label={t('widgets.field.latestTemplate')}
        hint={t('widgets.templateHint', {
          vars: ALERT_TEMPLATE_VARS.map((name) => `{${name}}`).join(', '),
        })}
      />
      <CheckboxField form={form} name="showMessage" label={t('widgets.field.showMessage')} />
      <TextField
        form={form}
        name="emptyText"
        label={t('widgets.field.emptyText')}
        hint={t('widgets.hint.emptyText')}
      />
      <p className="text-xs text-muted">{t('widgets.hint.latestTest')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Рулетка                                                             */
/* ------------------------------------------------------------------ */

function RouletteSpinSettings({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const donations = Boolean(form.watch('donationSpins'));

  return (
    <div className="space-y-6">
      <TextField form={form} name="title" label={t('widgets.field.rouletteTitle')} />

      <div className="space-y-4 border-t border-border pt-5">
        <CheckboxField form={form} name="donationSpins" label={t('widgets.field.donationSpins')} />
        {/* Цена — только когда донаты крутят колесо; значения при этом
            хранятся: включил обратно — цены на месте. */}
        {donations ? (
          <fieldset aria-describedby="spin-price-hint">
            <legend className="text-sm font-medium text-muted">
              {t('widgets.field.spinPrice')}
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {CURRENCIES.map((currency) => (
                <MoneyField
                  key={currency}
                  form={form}
                  name={`spinPrice.${currency}`}
                  label={currency}
                  currency={currency}
                  emptyValue={0}
                />
              ))}
            </div>
            <p id="spin-price-hint" className="mt-2 text-xs text-muted">
              {t('widgets.hint.spinPrice')}
            </p>
          </fieldset>
        ) : (
          <p className="text-sm text-muted">{t('widgets.hint.manualOnly')}</p>
        )}
      </div>

      <div className="grid gap-x-6 gap-y-5 border-t border-border pt-5 sm:grid-cols-2">
        <RangeField
          form={form}
          name="spinDurationMs"
          label={t('widgets.field.spinDuration')}
          min={3}
          max={20}
          step={0.5}
          scale={0.001}
          unit={t('widgets.unit.seconds')}
        />
        <RangeField
          form={form}
          name="resultMs"
          label={t('widgets.field.resultDuration')}
          min={1}
          max={30}
          step={0.5}
          scale={0.001}
          unit={t('widgets.unit.seconds')}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CheckboxField form={form} name="showDonor" label={t('widgets.field.showDonor')} />
        <CheckboxField form={form} name="hideWhenIdle" label={t('widgets.field.hideWhenIdle')} />
      </div>
    </div>
  );
}

/**
 * Сколько секторов помещается сейчас.
 *
 * Вид решает предел (у колеса двадцать четыре, у ленты сто), а тариф решает,
 * какой вид доедет до кадра: без «Про» лента становится колесом, и список,
 * набранный длиннее, в эфире всё равно обрежется. Поэтому предел считается по
 * тому виду, который увидят зрители, а не по выбранному в форме.
 */
function useSectorLimit(form: UseFormReturn<FieldValues>): number {
  const pro = usePlanAccess('advancedStyling');
  const mode = (form.watch('mode') as RouletteMode | undefined) ?? 'wheel';
  return maxRouletteSectors(pro ? mode : 'wheel');
}

function RouletteSectorsSection({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  return <RouletteSectors form={form} maxSectors={useSectorLimit(form)} />;
}

function RouletteLook({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const textLabels = useTextLabels();
  const pro = usePlanAccess('advancedStyling');
  const vertical = form.watch('mode') === 'vertical';
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <SelectField
          form={form}
          name="mode"
          label={t('widgets.field.rouletteMode')}
          options={ROULETTE_MODES.map((value) => ({
            value,
            label: t(`widgets.rouletteMode.${value}`),
          }))}
        />
        <p className="max-w-prose text-xs text-muted">
          {t('widgets.hint.rouletteMode', { max: MAX_VERTICAL_SECTORS })}
        </p>
        {/* Настройка остаётся, а в кадр без «Про» идёт колесо — как и всё
            продвинутое оформление. Молча показывать не то, что выбрано, нельзя. */}
        {vertical && !pro ? <PlanPaywall gate="advancedStyling" /> : null}
      </div>
      <div className="grid gap-x-6 gap-y-5 border-t border-border pt-5 sm:grid-cols-2">
        <RangeField
          form={form}
          name="wheelSize"
          label={t('widgets.field.wheelSize')}
          min={160}
          max={1200}
          step={10}
          unit="px"
        />
        <ColorField form={form} name="rimColor" label={t('widgets.field.rimColor')} />
      </div>
      <div className="border-t border-border pt-5">
        <TextStyleFields
          form={form}
          labels={{ ...textLabels, highlightColor: t('widgets.field.pointerColor') }}
          withHighlight
        />
      </div>
    </div>
  );
}

/**
 * Раскладка гостей: автоматическая (сетка, ряд, столбик) или свободная, где у
 * каждого места своя рамка в кадре.
 */
function GuestsLayout({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const free = form.watch('layout') === 'free';
  return (
    <div className="space-y-6">
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <SelectField
          form={form}
          name="layout"
          label={t('widgets.field.guestsLayout')}
          options={GUEST_LAYOUTS.map((value) => ({
            value,
            label: t(`widgets.guestsLayout.${value}`),
          }))}
        />
        <RangeField
          form={form}
          name="maxTiles"
          label={t('widgets.field.maxTiles')}
          min={1}
          max={MAX_GUESTS_PER_ROOM}
        />
        {/* Зазор — только у автоматических раскладок: в свободной места стоят
            там, где их поставили, и расстояние между ними задаёт сам стример. */}
        {free ? null : (
          <RangeField
            form={form}
            name="gap"
            label={t('widgets.field.tileGap')}
            min={0}
            max={48}
            unit="px"
          />
        )}
      </div>
      {free ? (
        <GuestSeatsCanvas
          form={form}
          canvas={canvasOf({ canvas: form.watch('canvas') })}
          underlay={
            <WidgetSurface
              type="guests"
              config={form.watch() as Record<string, unknown>}
              state={null}
              alertScenario="donation"
            />
          }
        />
      ) : null}
    </div>
  );
}
