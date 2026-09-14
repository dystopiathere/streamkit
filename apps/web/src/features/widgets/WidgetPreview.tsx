import type {
  AlertWidgetConfig,
  ChatMessage,
  ChatWidgetConfig,
  GoalWidgetConfig,
  GuestsWidgetConfig,
  TimerWidgetConfig,
  TopDonorsWidgetConfig,
  WidgetState,
  WidgetType,
} from '@streamkit/contracts';
import { defaultWidgetConfig } from '@streamkit/contracts';
import {
  AlertAnimationStyles,
  AlertCard,
  ChatBox,
  GoalBar,
  ParticipantLayout,
  TimerDisplay,
  TopDonorsList,
} from '@streamkit/ui';

/** Событие-пустышка: показывает, как алерт выглядит в эфире. */
const PREVIEW_EVENT = {
  username: 'Зритель',
  message: 'Спасибо за стрим! Держи на кофе.',
  amount: { amountMinor: 50_000, currency: 'RUB' as const },
  type: 'donation' as const,
};

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
}: {
  type: WidgetType;
  config: Record<string, unknown>;
  state: WidgetState | null;
}): React.JSX.Element {
  return (
    // Клетчатый фон вместо сплошного: у оверлея прозрачный фон, и на
    // однотонной подложке невозможно оценить читаемость обводки.
    <div
      className="flex h-64 items-center justify-center overflow-hidden rounded-lg"
      style={{
        backgroundImage:
          'linear-gradient(45deg, #2a2a35 25%, transparent 25%), linear-gradient(-45deg, #2a2a35 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a35 75%), linear-gradient(-45deg, transparent 75%, #2a2a35 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
      }}
    >
      <Surface type={type} config={config} state={state} />
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

function Surface({
  type,
  config: raw,
  state,
}: {
  type: WidgetType;
  config: Record<string, unknown>;
  state: WidgetState | null;
}): React.JSX.Element | null {
  const config = withDefaults(type, raw);

  switch (type) {
    case 'alerts':
      return (
        <>
          <AlertAnimationStyles />
          <AlertCard
            event={PREVIEW_EVENT}
            config={config as unknown as AlertWidgetConfig}
            animate={false}
          />
        </>
      );

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
                  currency: goal.currency,
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
      return <ChatBox config={{ ...chat, messageLifetimeSeconds: 0 }} messages={SAMPLE_CHAT} />;
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
                  currency: top.currency,
                  entries: SAMPLE_DONORS.slice(0, top.limit),
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
          <ParticipantLayout config={guests} tiles={SAMPLE_GUESTS} />
        </div>
      );
    }
  }
}

const SAMPLE_GUESTS = [
  { name: 'Гость подкаста', hue: 262 },
  { name: 'Соведущий', hue: 190 },
  { name: 'Эксперт', hue: 32 },
].map(({ name, hue }, index) => ({
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
}));

const SAMPLE_DONORS = [
  { username: 'Аня', amountMinor: 250_000, count: 4 },
  { username: 'Кирилл', amountMinor: 150_000, count: 2 },
  { username: 'Аноним', amountMinor: 90_000, count: 7 },
  { username: 'Даша', amountMinor: 50_000, count: 1 },
  { username: 'Пётр', amountMinor: 30_000, count: 3 },
  { username: 'Лена', amountMinor: 20_000, count: 2 },
  { username: 'Максим', amountMinor: 15_000, count: 1 },
  { username: 'Соня', amountMinor: 12_000, count: 2 },
  { username: 'Игорь', amountMinor: 9_000, count: 1 },
  { username: 'Вика', amountMinor: 5_000, count: 1 },
];

/**
 * Пример чата. Ники и реплики выдуманы, эмоут настоящий (Kappa, id 25) — без
 * него не видно, как строка живёт с картинкой внутри.
 */
const SAMPLE_CHAT: ChatMessage[] = [
  {
    id: 'sample-1',
    platform: 'twitch',
    channel: 'example',
    login: 'zritel',
    username: 'Зритель',
    color: '#7FD1B9',
    badges: ['subscriber'],
    parts: [{ kind: 'text', value: 'привет, как настройка идёт?' }],
    sentAt: '2026-09-12T20:00:00.000Z',
  },
  {
    id: 'sample-2',
    platform: 'twitch',
    channel: 'example',
    login: 'moder',
    username: 'Модератор',
    color: '#E0A3F5',
    badges: ['moderator', 'vip'],
    parts: [
      { kind: 'text', value: 'сейчас проверим ' },
      { kind: 'emote', id: '25', alt: 'Kappa' },
    ],
    sentAt: '2026-09-12T20:00:05.000Z',
  },
  {
    id: 'sample-3',
    platform: 'twitch',
    channel: 'example',
    login: 'gost',
    username: 'Гость',
    color: null,
    badges: [],
    parts: [{ kind: 'text', value: 'шрифт читается, обводки хватает' }],
    sentAt: '2026-09-12T20:00:09.000Z',
  },
];
