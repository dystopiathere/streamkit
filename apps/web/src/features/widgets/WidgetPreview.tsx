import type {
  AlertEvent,
  AlertEventType,
  AlertScenarioConfig,
  ChatMessage,
  ChatWidgetConfig,
  GoalWidgetConfig,
  GuestsWidgetConfig,
  TimerWidgetConfig,
  TopDonorsWidgetConfig,
  WidgetState,
  WidgetType,
} from '@streamkit/contracts';
import {
  applyPlanToConfig,
  defaultAlertWidgetConfig,
  defaultWidgetConfig,
  type Language,
} from '@streamkit/contracts';
import {
  AlertAnimationStyles,
  AlertCard,
  ChatBox,
  GoalBar,
  ParticipantLayout,
  TimerDisplay,
  TopDonorsList,
} from '@streamkit/ui';
import { usePlanFeatures } from '@/features/billing/PlanPaywall';
import { currentLanguage } from '@/lib/locale';

/**
 * Предпросмотр виджета.
 *
 * Использует ТЕ ЖЕ рендереры, что и overlay: иначе расхождение «в редакторе
 * одно, на стриме другое» — лишь вопрос времени.
 *
 * Состояние берётся настоящее, если оно уже посчитано сервером, и подменяется
 * правдоподобным примером, если нет. Пустая полоса и пустой топ ничего не
 * говорят о том, как виджет будет выглядеть в эфире, а настраивают его обычно
 * до первого доната.
 */
export function WidgetPreview({
  type,
  config,
  state,
  alertScenario = 'donation',
}: {
  type: WidgetType;
  config: Record<string, unknown>;
  state: WidgetState | null;
  /** Какой сценарий оповещений показать — тот, что открыт в форме. */
  alertScenario?: AlertEventType;
}): React.JSX.Element {
  return (
    // Клетчатый фон вместо сплошного: у оверлея прозрачный фон, и на
    // однотонной подложке невозможно оценить читаемость обводки.
    <div className="checkerboard flex h-64 items-center justify-center overflow-hidden rounded-lg">
      <Surface type={type} config={config} state={state} alertScenario={alertScenario} />
    </div>
  );
}

/**
 * Значения формы поверх дефолтов своего типа.
 *
 * Нужно из-за одного кадра на переходе: форма наполняется значениями виджета
 * из эффекта, то есть уже ПОСЛЕ первого рендера с новым типом. В этом кадре
 * `form.watch()` ещё отдаёт значения предыдущего типа, и рендерер получает
 * конфиг не от того виджета. Для цели это безобидно (число превращается в NaN),
 * а для чата — падение на первом же обращении к списку скрытых ников, то есть
 * пустая страница редактора вместо предпросмотра.
 *
 * Слияние, а не разбор схемой: значение в поле бывает недописанным и схему не
 * проходит, но показывать его в предпросмотре всё равно надо — ради этого
 * предпросмотр и существует.
 */
function withDefaults(type: WidgetType, config: Record<string, unknown>): Record<string, unknown> {
  return { ...defaultWidgetConfig(type).config, ...config };
}

/**
 * Предпросмотр показывает то, что уйдёт в кадр, — с учётом тарифа.
 *
 * Без «Про» продвинутое оформление остаётся в настройках, но в кадр не идёт
 * (сервер урезает конфиг на выходе к оверлею той же функцией). Если бы
 * предпросмотр рисовал его, стример настраивал бы раскладку, видел её в
 * редакторе и не находил на стриме — самая дорогая разновидность расхождения.
 */
function usePlanConfig(config: Record<string, unknown>): Record<string, unknown> {
  const features = usePlanFeatures();
  // Пока тариф не загрузился, показываем как есть: мигать оформлением у того,
  // кто заплатил, хуже, чем один кадр показать лишнее тому, кто нет.
  return features ? applyPlanToConfig(config, features) : config;
}

/**
 * Сам виджет без подложки предпросмотра — для кадра раскладки, где он лежит под
 * ручками элементов: двигают то, что видно, а не подписи в пустом кадре.
 */
export function WidgetSurface(props: {
  type: WidgetType;
  config: Record<string, unknown>;
  state: WidgetState | null;
  alertScenario: AlertEventType;
}): React.JSX.Element | null {
  return <Surface {...props} />;
}

function Surface({
  type,
  config: raw,
  state,
  alertScenario,
}: {
  type: WidgetType;
  config: Record<string, unknown>;
  state: WidgetState | null;
  alertScenario: AlertEventType;
}): React.JSX.Element | null {
  const config = usePlanConfig(withDefaults(type, raw));
  // Примеры — на языке дашборда: русский «Зритель» в английском интерфейсе
  // выглядел бы непереведённым куском, а не данными.
  const sample = SAMPLES[currentLanguage()];

  switch (type) {
    case 'alerts': {
      // Сценарий из формы поверх своих дефолтов — по той же причине, что и весь
      // конфиг выше: в переходном кадре формы его может ещё не быть.
      const scenarios = (config.scenarios ?? {}) as Partial<Record<AlertEventType, object>>;
      const scenario = {
        ...DEFAULT_SCENARIOS[alertScenario],
        ...scenarios[alertScenario],
      } as AlertScenarioConfig;
      return (
        <>
          <AlertAnimationStyles />
          <AlertCard event={sample.events[alertScenario]} config={scenario} animate={false} />
        </>
      );
    }

    case 'goal': {
      const goal = config as unknown as GoalWidgetConfig;
      return (
        <GoalBar
          config={goal}
          state={
            state?.kind === 'goal'
              ? state
              : {
                  kind: 'goal',
                  // Треть цели: полоса видна, но очевидно, что это пример.
                  raisedMinor: Math.round(goal.targetMinor / 3),
                  targetMinor: goal.targetMinor,
                  currency: 'RUB',
                  offsetMinor: 0,
                }
          }
        />
      );
    }

    case 'timer': {
      const timer = config as unknown as TimerWidgetConfig;
      return (
        <TimerDisplay
          config={timer}
          state={
            state?.kind === 'timer'
              ? state
              : {
                  kind: 'timer',
                  endsAt: null,
                  pausedSeconds: timer.initialSeconds,
                  serverNow: new Date().toISOString(),
                  currency: 'RUB',
                }
          }
        />
      );
    }

    case 'chat': {
      const chat = config as unknown as ChatWidgetConfig;
      // Пример показываем всегда: настраивают чат до эфира, а пустая рамка
      // ничего не говорит ни про размер шрифта, ни про читаемость обводки.
      //
      // Гашение строк в примере выключено. У примера метки времени застывшие,
      // и через заданное число секунд все три строки гасли — предпросмотр
      // пустел навсегда, будто настройка сломала виджет.
      return <ChatBox config={{ ...chat, messageLifetimeSeconds: 0 }} messages={sample.chat} />;
    }

    case 'top-donors': {
      const top = config as unknown as TopDonorsWidgetConfig;
      return (
        <TopDonorsList
          config={top}
          state={
            state?.kind === 'top-donors' && state.entries.length > 0
              ? state
              : {
                  kind: 'top-donors',
                  currency: 'RUB',
                  entries: sample.donors.slice(0, top.limit),
                }
          }
        />
      );
    }

    case 'guests': {
      // Плитки-заглушки: гости появятся только в эфире, а настраивать раскладку
      // нужно заранее. Рендерер тот же, что в оверлее, — видео подменено фоном.
      const guests = config as unknown as GuestsWidgetConfig;
      return (
        <div className="h-full w-full p-4">
          <ParticipantLayout config={guests} tiles={sample.guests} />
        </div>
      );
    }
  }
}

const DEFAULT_SCENARIOS = defaultAlertWidgetConfig().scenarios;

/** Тексты примеров. Имена и реплики выдуманы. */
const SAMPLE_TEXT: Record<
  Language,
  {
    event: { username: string; message: string; reward: string };
    guests: [string, string, string];
    donors: string[];
    chat: [string, string, string];
    chatNames: [string, string, string];
  }
> = {
  ru: {
    event: {
      username: 'Зритель',
      message: 'Спасибо за стрим! Держи на кофе.',
      reward: 'Выбрать игру',
    },
    guests: ['Гость подкаста', 'Соведущий', 'Эксперт'],
    donors: ['Аня', 'Кирилл', 'Аноним', 'Даша', 'Пётр', 'Лена', 'Максим', 'Соня', 'Игорь', 'Вика'],
    chatNames: ['Зритель', 'Модератор', 'Гость'],
    chat: ['привет, как настройка идёт?', 'сейчас проверим ', 'шрифт читается, обводки хватает'],
  },
  en: {
    event: {
      username: 'Viewer',
      message: 'Thanks for the stream! Coffee is on me.',
      reward: 'Pick the game',
    },
    guests: ['Podcast guest', 'Co-host', 'Expert'],
    donors: [
      'Anna',
      'Kirill',
      'Anonymous',
      'Dasha',
      'Peter',
      'Lena',
      'Max',
      'Sonya',
      'Igor',
      'Vika',
    ],
    chatNames: ['Viewer', 'Moderator', 'Guest'],
    chat: [
      'hi, how is the setup going?',
      'let me check ',
      'the font is readable, the outline is enough',
    ],
  },
};

const DONOR_AMOUNTS = [
  [250_000, 4],
  [150_000, 2],
  [90_000, 7],
  [50_000, 1],
  [30_000, 3],
  [20_000, 2],
  [15_000, 1],
  [12_000, 2],
  [9_000, 1],
  [5_000, 1],
] as const;

const GUEST_HUES = [262, 190, 32];

/** Примеры собираются один раз на язык: плитки гостей не пересоздаются на каждый рендер. */
const SAMPLES = {
  ru: buildSamples(SAMPLE_TEXT.ru),
  en: buildSamples(SAMPLE_TEXT.en),
};

function buildSamples(text: (typeof SAMPLE_TEXT)[Language]) {
  return {
    /** События-пустышки по сценариям: сумма и количество — там, где они бывают. */
    events: sampleEvents(text.event),
    guests: text.guests.map((name, index) => {
      const hue = GUEST_HUES[index] ?? 0;
      return {
        id: `sample-${index}`,
        name,
        // Третий «гость» — с выключенной камерой: так видно, как выглядит плитка без видео.
        hasVideo: index < 2,
        media: (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${hue + 40} 50% 18%))`,
            }}
          />
        ),
      };
    }),
    donors: DONOR_AMOUNTS.map(([amountMinor, count], index) => ({
      username: text.donors[index] ?? '',
      amountMinor,
      count,
    })),
    chat: sampleChat(text.chatNames, text.chat),
  };
}

/**
 * Пример чата. Эмоут настоящий (Kappa, id 25) — без него не видно, как строка
 * живёт с картинкой внутри.
 */
function sampleChat(
  [viewer, moderator, guest]: [string, string, string],
  [first, second, third]: [string, string, string],
): ChatMessage[] {
  return [
    {
      id: 'sample-1',
      platform: 'twitch',
      channel: 'example',
      login: 'zritel',
      username: viewer,
      color: '#7FD1B9',
      badges: ['subscriber'],
      parts: [{ kind: 'text', value: first }],
      sentAt: '2026-09-12T20:00:00.000Z',
    },
    {
      id: 'sample-2',
      platform: 'twitch',
      channel: 'example',
      login: 'moder',
      username: moderator,
      color: '#E0A3F5',
      badges: ['moderator', 'vip'],
      parts: [
        { kind: 'text', value: second },
        { kind: 'emote', id: '25', alt: 'Kappa' },
      ],
      sentAt: '2026-09-12T20:00:05.000Z',
    },
    // Третья строка — с YouTube: предпросмотр показывает мультичат так, как
    // его увидят зрители, со значками площадок.
    {
      id: 'sample-3',
      platform: 'youtube',
      channel: 'UCsampleChannel00000000a',
      login: 'UCsampleViewer000000000a',
      username: guest,
      color: null,
      badges: ['member'],
      parts: [{ kind: 'text', value: third }],
      sentAt: '2026-09-12T20:00:09.000Z',
    },
  ];
}

type SampleEvent = Pick<AlertEvent, 'type' | 'username' | 'message' | 'amount' | 'count'>;

function sampleEvents(text: {
  username: string;
  message: string;
  reward: string;
}): Record<AlertEventType, SampleEvent> {
  const event = (
    type: AlertEventType,
    extra: Partial<Pick<SampleEvent, 'message' | 'amount' | 'count'>> = {},
  ): SampleEvent => ({
    type,
    username: text.username,
    message: '',
    amount: null,
    count: null,
    ...extra,
  });
  return {
    donation: event('donation', {
      message: text.message,
      amount: { amountMinor: 50_000, currency: 'RUB' },
    }),
    follow: event('follow'),
    subscription: event('subscription'),
    gift: event('gift', { count: 5 }),
    resubscription: event('resubscription', { message: text.message, count: 12 }),
    cheer: event('cheer', { message: text.message, count: 500 }),
    raid: event('raid', { count: 42 }),
    reward: event('reward', { message: text.reward }),
  };
}
