import type {
  AlertEvent,
  AlertEventType,
  AlertScenarioConfig,
  ChatMessage,
  ChatWidgetConfig,
  GoalWidgetConfig,
  GuestsWidgetConfig,
  LatestWidgetConfig,
  RouletteSpin,
  RouletteWidgetConfig,
  TimerWidgetConfig,
  TopDonorsWidgetConfig,
  WidgetCanvas,
  WidgetState,
  WidgetType,
} from '@streamkit/contracts';
import {
  ALERT_APPEARANCE_FIELDS,
  type AlertTrigger,
  applyPlanToConfig,
  widgetCanvasSchema,
  defaultAlertWidgetConfig,
  defaultWidgetConfig,
  type Language,
} from '@streamkit/contracts';
import {
  ALERT_ENTER_DURATION_MS,
  ALERT_EXIT_DURATION_MS,
  AlertAnimationStyles,
  AlertCard,
  exitAnimationName,
  ChatBox,
  GoalBar,
  LatestEventDisplay,
  ParticipantLayout,
  RouletteDisplay,
  TimerDisplay,
  TopDonorsList,
  WidgetStage,
} from '@streamkit/ui';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@streamkit/app-kit';
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
  alertTrigger = null,
  rouletteSpin = null,
  onRouletteFinished,
}: {
  type: WidgetType;
  config: Record<string, unknown>;
  state: WidgetState | null;
  /** Какой сценарий оповещений показать — тот, что открыт в форме. */
  alertScenario?: AlertEventType;
  /** Триггер сценария, чей вид правят сейчас. null — вид самого сценария. */
  alertTrigger?: string | null;
  /** Прокрут рулетки, который проиграть в предпросмотре. */
  rouletteSpin?: RouletteSpin | null;
  onRouletteFinished?: (spinId: string) => void;
}): React.JSX.Element {
  const canvas = canvasOf(config);
  const surface = (
    <Surface
      type={type}
      config={config}
      state={state}
      alertScenario={alertScenario}
      alertTrigger={alertTrigger}
      rouletteSpin={rouletteSpin}
      onRouletteFinished={onRouletteFinished}
    />
  );
  // Окно задано — предпросмотр показывает ровно браузер-сорс этого размера,
  // уменьшенный под колонку: и пропорции, и обрезку того, что вылезло за окно.
  // Не задано (виджеты до появления окна) — прежний кадр с автомасштабом.
  if (!canvas) return <FitToFrame>{surface}</FitToFrame>;
  return (
    <CanvasFrame canvas={canvas} className="checkerboard rounded-lg">
      <WidgetStage canvas={canvas}>{surface}</WidgetStage>
    </CanvasFrame>
  );
}

/** Окно виджета из значений формы; null — не задано или недописано. */
export function canvasOf(config: Record<string, unknown>): WidgetCanvas | null {
  const parsed = widgetCanvasSchema.safeParse(config.canvas);
  return parsed.success ? parsed.data : null;
}

/**
 * Рамка с пропорциями окна виджета во всю ширину колонки. Высокое окно
 * (например, чат 400×800) не должно вытягивать колонку на несколько экранов,
 * поэтому высота ограничена, а ширина под неё сужается.
 */
export function CanvasFrame({
  canvas,
  className,
  children,
  frameRef,
  testId,
}: {
  canvas: WidgetCanvas;
  className?: string;
  children: ReactNode;
  frameRef?: React.Ref<HTMLDivElement>;
  testId?: string;
}): React.JSX.Element {
  return (
    <div
      ref={frameRef}
      data-testid={testId ?? 'widget-preview'}
      className={cn('relative mx-auto overflow-hidden', className)}
      style={{
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        width: `min(100%, calc(60vh * ${canvas.width / canvas.height}))`,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Кадр предпросмотра: 16:9, как сцена OBS, и содержимое в нём целиком.
 *
 * Если виджет в кадр не помещается, предпросмотр показывает его как в
 * браузер-сорсе покрупнее: кадр виджета растёт в `1 / масштаб` раз и
 * уменьшается обратно на масштаб. Снаружи кадр по-прежнему во весь
 * предпросмотр — фон «Заполнить» закрывает его целиком, проценты позиций те
 * же, — а крупные элементы помещаются. Раньше уменьшался сам кадр: вокруг
 * оставались пустые поля, и фон выглядел обрезанным. В углу написан масштаб:
 * «так выглядит, но мельче», а не «так выглядит». Клетчатый фон — потому что
 * у оверлея фон прозрачный.
 */
function FitToFrame({ children }: { children: ReactNode }): React.JSX.Element {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Замер после каждого рендера (правка формы двигает и растит элементы), по
  // окончании анимации появления (в её середине размеры не настоящие) и при
  // смене размера окна. Масштаб каждый раз ищется заново от 100 %: сцена,
  // которая снова помещается, возвращается к полному размеру.
  useLayoutEffect(() => {
    const box = frame.current;
    const content = layer.current;
    if (!box || !content) return;
    let frameId = 0;
    const measure = (): void => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const next = searchScale((candidate) => {
          applyLayer(content, candidate);
          return overflows(box, content);
        });
        applyLayer(content, next);
        setScale(next);
      });
    };
    measure();
    content.addEventListener('animationend', measure);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    observer?.observe(box);
    return () => {
      cancelAnimationFrame(frameId);
      content.removeEventListener('animationend', measure);
      observer?.disconnect();
    };
  });

  return (
    <div
      ref={frame}
      data-testid="widget-preview"
      className="checkerboard relative aspect-video w-full overflow-hidden rounded-lg"
    >
      <div
        ref={layer}
        className="absolute flex items-center justify-center"
        style={layerStyle(scale)}
      >
        {children}
      </div>
      {scale < 1 ? (
        <span className="absolute right-2 bottom-2 rounded bg-bg/85 px-1.5 py-0.5 text-xs text-muted tabular-nums">
          {t('widgets.previewScaled', { percent: Math.round(scale * 100) })}
        </span>
      ) : null}
    </div>
  );
}

/** Допуск на дробные пиксели: край во весь кадр не должен считаться вылезшим. */
const SLACK_PX = 1;
/** Мельче не уменьшаем: при такой нехватке места виджет в кадре уже не разглядеть. */
const MIN_SCALE = 0.2;

/**
 * Слой содержимого при масштабе: кадр виджета больше предпросмотра в
 * `1 / scale` раз, по центру, и уменьшен обратно — снаружи ровно во весь
 * предпросмотр.
 */
function layerStyle(scale: number): CSSProperties {
  const size = 100 / scale;
  const offset = (100 - size) / 2;
  return {
    left: `${offset}%`,
    top: `${offset}%`,
    width: `${size}%`,
    height: `${size}%`,
    transform: scale < 1 ? `scale(${scale})` : undefined,
  };
}

function applyLayer(layer: HTMLElement, scale: number): void {
  const style = layerStyle(scale);
  layer.style.left = String(style.left);
  layer.style.top = String(style.top);
  layer.style.width = String(style.width);
  layer.style.height = String(style.height);
  layer.style.transform = scale < 1 ? `scale(${scale})` : '';
}

/**
 * Самый крупный масштаб, при котором ничего не вылезает. Двоичным поиском:
 * при масштабе меньше кадр виджета больше, и то, что влезло, влезет и дальше.
 */
export function searchScale(overflowsAt: (scale: number) => boolean): number {
  if (!overflowsAt(1)) return 1;
  let fits = MIN_SCALE;
  let tooBig = 1;
  for (let step = 0; step < 8; step += 1) {
    const middle = (fits + tooBig) / 2;
    if (overflowsAt(middle)) tooBig = middle;
    else fits = middle;
  }
  return Math.floor(fits * 100) / 100;
}

/**
 * Вылезает ли что-то за кадр предпросмотра.
 *
 * Меряются корень виджета, элементы кадра (`data-slot`) и плитки гостей, а не
 * все узлы подряд: строки чата за нижним краем своего блока обрезаны самим
 * блоком, и учёт каждой уменьшал бы предпросмотр без причины.
 */
export function overflows(box: HTMLElement, content: HTMLElement): boolean {
  const frame = box.getBoundingClientRect();
  if (frame.width === 0 || frame.height === 0) return false;
  const nodes = [
    ...Array.from(content.children),
    ...Array.from(content.querySelectorAll('[data-slot], [data-testid="participant-tile"]')),
  ];
  return nodes.some((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return (
      rect.left < frame.left - SLACK_PX ||
      rect.top < frame.top - SLACK_PX ||
      rect.right > frame.right + SLACK_PX ||
      rect.bottom > frame.bottom + SLACK_PX
    );
  });
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
  alertTrigger?: string | null;
}): React.JSX.Element | null {
  return <Surface {...props} />;
}

/**
 * Оповещение в предпросмотре и его анимация.
 *
 * Обычно карточка стоит неподвижно: предпросмотр перерисовывается на каждое
 * нажатие клавиши в поле шаблона, и анимация при каждом из них превратила бы его
 * в мигалку. Но выбрать анимацию, ни разу её не увидев, нельзя — поэтому смена
 * самой анимации проигрывает её один раз, ту, которая выбрана.
 *
 * Уход показывается от видимой карточки и возвращает её обратно: иначе
 * предпросмотр остался бы пустым, а выбирают анимацию именно глядя на него.
 * Тому, кто попросил систему не двигать интерфейс, тема дашборда сводит
 * длительность к нулю — карточка просто моргнёт.
 */
function AlertSurface({
  event,
  scenario,
}: {
  event: SampleEvent;
  scenario: AlertScenarioConfig;
}): React.JSX.Element {
  const [play, setPlay] = useState<{ id: number; kind: 'in' | 'out' } | null>(null);
  const seen = useRef<{ in: string; out: string } | null>(null);

  useEffect(() => {
    const previous = seen.current;
    seen.current = { in: scenario.animationIn, out: scenario.animationOut };
    // Первый кадр — не смена настройки: открытие редактора ничего не проигрывает.
    if (!previous) return;
    const kind =
      previous.in !== scenario.animationIn
        ? 'in'
        : previous.out !== scenario.animationOut
          ? 'out'
          : null;
    if (kind) setPlay((current) => ({ id: (current?.id ?? 0) + 1, kind }));
  }, [scenario.animationIn, scenario.animationOut]);

  // Показ снимается по времени самой анимации, а не по событию `animationend`:
  // уход оставляет карточку невидимой (`both`), и ждать события, которое может
  // не прийти — например, когда вкладку свернули, — значит оставить пустой кадр.
  useEffect(() => {
    if (!play) return;
    const timer = setTimeout(
      () => setPlay(null),
      play.kind === 'in' ? ALERT_ENTER_DURATION_MS : ALERT_EXIT_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [play]);

  return (
    <>
      <AlertAnimationStyles />
      {/* Ключ меняется на каждый показ: без него повторный выбор той же
          анимации не перезапустил бы её — для браузера это та же анимация на том
          же элементе. */}
      <div
        key={play?.id ?? 'still'}
        style={{
          width: '100%',
          height: '100%',
          animation:
            play?.kind === 'out'
              ? `${exitAnimationName(scenario.animationOut)} ${ALERT_EXIT_DURATION_MS}ms ease-in both`
              : undefined,
        }}
      >
        <AlertCard event={event} config={scenario} animate={play?.kind === 'in'} />
      </div>
    </>
  );
}

function Surface({
  type,
  config: raw,
  state,
  alertScenario,
  alertTrigger = null,
  rouletteSpin = null,
  onRouletteFinished,
}: {
  type: WidgetType;
  config: Record<string, unknown>;
  state: WidgetState | null;
  alertScenario: AlertEventType;
  alertTrigger?: string | null;
  rouletteSpin?: RouletteSpin | null;
  onRouletteFinished?: (spinId: string) => void;
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
      const base = {
        ...DEFAULT_SCENARIOS[alertScenario],
        ...scenarios[alertScenario],
      } as AlertScenarioConfig;
      // Правят вид триггера — показываем его, и пример доната подходит под его
      // условие: «от тысячи» с примером на 500 ₽ читался бы неправдой.
      const trigger = alertTrigger
        ? base.triggers?.find((item) => item.id === alertTrigger)
        : undefined;
      const scenario = trigger ? withTriggerAppearance(base, trigger) : base;
      const event = trigger
        ? { ...sample.events[alertScenario], amount: triggerSampleAmount(trigger) }
        : sample.events[alertScenario];
      return <AlertSurface event={event} scenario={scenario} />;
    }

    case 'latest': {
      const latest = config as unknown as LatestWidgetConfig;
      // Настоящее последнее событие, если оно было, иначе пример выбранного
      // типа: пустой предпросмотр ничего не говорит о шаблоне строки.
      return (
        <LatestEventDisplay
          config={latest}
          state={
            state?.kind === 'latest' && state.event
              ? state
              : {
                  kind: 'latest',
                  event: {
                    ...sample.events[latest.eventType],
                    createdAt: '2026-09-12T20:00:00.000Z',
                  },
                }
          }
        />
      );
    }

    case 'roulette':
      return (
        <RouletteDisplay
          config={config as unknown as RouletteWidgetConfig}
          spin={rouletteSpin}
          onFinished={onRouletteFinished}
        />
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
      // Без полей вокруг: в OBS их нет, и предпросмотр обязан совпадать с кадром.
      return (
        <div className="h-full w-full">
          <ParticipantLayout config={guests} tiles={sample.guests} />
        </div>
      );
    }
  }
}

const DEFAULT_SCENARIOS = defaultAlertWidgetConfig().scenarios;

/** Сценарий с видом триггера — так же, как его соберёт `resolveAlertScenario` в кадре. */
function withTriggerAppearance(
  scenario: AlertScenarioConfig,
  trigger: AlertTrigger,
): AlertScenarioConfig {
  const appearance = Object.fromEntries(
    ALERT_APPEARANCE_FIELDS.map((field) => [field, trigger[field]]),
  );
  return { ...scenario, ...appearance } as AlertScenarioConfig;
}

/**
 * Сумма, которая подходит под условие триггера: пример в предпросмотре и
 * тестовый донат из редактора. Строго больше и строго меньше — на рубль в
 * сторону от границы.
 */
export function triggerSampleAmount(trigger: Pick<AlertTrigger, 'condition'>): {
  amountMinor: number;
  currency: AlertTrigger['condition']['currency'];
} {
  const { operator, amountMinor, currency } = trigger.condition;
  const value =
    operator === 'gt'
      ? amountMinor + 100
      : operator === 'lt'
        ? Math.max(0, amountMinor - 100)
        : amountMinor;
  return { amountMinor: Number.isFinite(value) ? value : 0, currency };
}

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
    kicks: event('kicks', { message: text.message, count: 100 }),
    raid: event('raid', { count: 42 }),
    reward: event('reward', { message: text.reward }),
  };
}
