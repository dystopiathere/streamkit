import { describe, expect, it } from 'vitest';
import {
  ALERT_ANIMATIONS,
  ALERT_SLOTS,
  alertWidgetConfigSchema,
  applyPlanToConfig,
  BASIC_ALERT_ANIMATIONS,
  EMPTY_BACKGROUND,
  EMPTY_SLOT,
  type GoalWidgetConfig,
  goalWidgetConfigSchema,
  WIDGET_SLOTS,
  type WidgetType,
  configSchemaFor,
  defaultAlertWidgetConfig,
  defaultWidgetConfig,
  donationSeconds,
  formatDuration,
  hasWidgetState,
  goalProgress,
  renderTemplate,
  shouldShowAlert,
  timerRemainingSeconds,
  WIDGET_TYPES,
  widgetConfigSchema,
} from './widgets.js';
import { ALERT_EVENT_TYPES, type AlertEvent, type AlertEventType } from './events.js';

function event(
  overrides: Partial<AlertEvent> = {},
): Pick<AlertEvent, 'type' | 'amount' | 'count' | 'isTest'> {
  return {
    type: 'donation',
    amount: { amountMinor: 10_000, currency: 'RUB' },
    count: null,
    isTest: false,
    ...overrides,
  };
}

/** Конфиг с правками одного сценария поверх дефолтов. */
function withScenario(type: AlertEventType, scenario: Record<string, unknown>) {
  return alertWidgetConfigSchema.parse({ scenarios: { [type]: scenario } });
}

describe('renderTemplate', () => {
  it('подставляет известные переменные', () => {
    expect(
      renderTemplate('{username} задонатил {amount}', { username: 'Вася', amount: '100 ₽' }),
    ).toBe('Вася задонатил 100 ₽');
  });

  it('оставляет неизвестный плейсхолдер как есть, не ломая строку', () => {
    expect(renderTemplate('{username} → {unknown}', { username: 'Вася' })).toBe('Вася → {unknown}');
  });

  it('подставляет пустую строку, если переменная задана пустой', () => {
    expect(renderTemplate('[{message}]', { message: '' })).toBe('[]');
  });

  it('не выполняет подстановку рекурсивно (значение с плейсхолдером остаётся текстом)', () => {
    expect(renderTemplate('{username}', { username: '{amount}' })).toBe('{amount}');
  });
});

describe('shouldShowAlert', () => {
  it('показывает событие включённого сценария', () => {
    expect(shouldShowAlert(event(), defaultAlertWidgetConfig())).toBe(true);
    expect(
      shouldShowAlert(event({ type: 'follow', amount: null }), defaultAlertWidgetConfig()),
    ).toBe(true);
  });

  it('отсекает событие выключенного сценария', () => {
    const config = withScenario('follow', { enabled: false });
    expect(shouldShowAlert(event({ type: 'follow', amount: null }), config)).toBe(false);
    // Соседние сценарии это не задевает.
    expect(shouldShowAlert(event(), config)).toBe(true);
  });

  it('порог суммы — у доната, на пороге показывает, ниже — нет', () => {
    const config = withScenario('donation', { minAmounts: { RUB: 5_000 } });
    const donation = (amountMinor: number) => event({ amount: { amountMinor, currency: 'RUB' } });
    expect(shouldShowAlert(donation(4_999), config)).toBe(false);
    expect(shouldShowAlert(donation(5_000), config)).toBe(true);
  });

  it('у каждой валюты свой порог, без пересчёта по курсу', () => {
    // Одно число на все валюты отсекало и 100 ₽, и 100 $ — либо мелочь в рублях
    // проходила, либо крупный донат в долларах пропадал.
    const config = withScenario('donation', { minAmounts: { RUB: 50_000, USD: 500 } });
    const donation = (amountMinor: number, currency: 'RUB' | 'USD' | 'EUR') =>
      event({ amount: { amountMinor, currency } });
    expect(shouldShowAlert(donation(10_000, 'RUB'), config)).toBe(false);
    expect(shouldShowAlert(donation(50_000, 'RUB'), config)).toBe(true);
    expect(shouldShowAlert(donation(499, 'USD'), config)).toBe(false);
    expect(shouldShowAlert(donation(500, 'USD'), config)).toBe(true);
    // Порога у валюты нет — показываются все её донаты.
    expect(shouldShowAlert(donation(1, 'EUR'), config)).toBe(true);
  });

  it('донат без суммы порогом не отсекается', () => {
    // Сумма неизвестна (незнакомая валюта): сравнить не с чем, и терять донат
    // на экране хуже, чем показать лишний.
    const config = withScenario('donation', { minAmounts: { RUB: 5_000 } });
    expect(shouldShowAlert(event({ amount: null }), config)).toBe(true);
  });

  it('порог количества — у битов и рейдов', () => {
    const config = withScenario('raid', { minCount: 10 });
    const raid = (count: number | null) => event({ type: 'raid', amount: null, count });
    expect(shouldShowAlert(raid(9), config)).toBe(false);
    expect(shouldShowAlert(raid(10), config)).toBe(true);
    expect(shouldShowAlert(raid(null), config)).toBe(false);
  });

  it('тест обходит пороги, но не выключенный сценарий', () => {
    const config = alertWidgetConfigSchema.parse({
      scenarios: { donation: { minAmounts: { RUB: 100_000 } }, raid: { enabled: false } },
    });
    expect(shouldShowAlert(event({ isTest: true }), config)).toBe(true);
    // Выключенный сценарий не покажет и тест: стример проверяет то, что увидят зрители.
    expect(shouldShowAlert(event({ type: 'raid', isTest: true }), config)).toBe(false);
  });
});

describe('alertWidgetConfigSchema', () => {
  it('заполняет каждый сценарий дефолтами из пустого объекта', () => {
    const config = defaultAlertWidgetConfig();
    expect(config.gapMs).toBe(500);
    for (const type of ALERT_EVENT_TYPES) {
      expect(config.scenarios[type].enabled).toBe(true);
      expect(config.scenarios[type].durationMs).toBe(6000);
      expect(config.scenarios[type].text.fontSize).toBe(32);
      expect(config.scenarios[type].sound.enabled).toBe(false);
    }
  });

  it('у сценариев свои шаблоны: у фолловера нет суммы, у рейда есть число зрителей', () => {
    const { scenarios } = defaultAlertWidgetConfig();
    expect(scenarios.donation.titleTemplate).toContain('{amount}');
    expect(scenarios.follow.titleTemplate).not.toContain('{amount}');
    expect(scenarios.raid.titleTemplate).toContain('{count}');
  });

  it('правка одного сценария не трогает остальные', () => {
    const config = withScenario('cheer', { durationMs: 9000 });
    expect(config.scenarios.cheer.durationMs).toBe(9000);
    expect(config.scenarios.donation.durationMs).toBe(6000);
  });

  it('отклоняет http-ссылку на звук (смешанный контент в OBS)', () => {
    const result = alertWidgetConfigSchema.safeParse({
      scenarios: { donation: { sound: { enabled: true, url: 'http://example.com/a.mp3' } } },
    });
    expect(result.success).toBe(false);
  });

  it('отклоняет некорректный цвет и отрицательный порог', () => {
    expect(withScenarioResult({ text: { color: 'red' } })).toBe(false);
    expect(withScenarioResult({ minAmounts: { RUB: -1 } })).toBe(false);
    expect(withScenarioResult({ minAmounts: { BTC: 100 } })).toBe(false);
    expect(withScenarioResult({ minCount: -1 })).toBe(false);
  });

  it('прежние поля общего конфига отбрасывает — их переносит миграция данных', () => {
    const config = alertWidgetConfigSchema.parse({ eventTypes: ['donation'], durationMs: 9000 });
    expect(config).not.toHaveProperty('eventTypes');
    expect(config.scenarios.donation.durationMs).toBe(6000);
  });
});

function withScenarioResult(scenario: Record<string, unknown>): boolean {
  return alertWidgetConfigSchema.safeParse({ scenarios: { donation: scenario } }).success;
}

describe('типы виджетов', () => {
  it('у каждого типа есть схема конфига', () => {
    // Реестр обязан быть полным: тип без схемы означает виджет, который
    // нельзя ни создать, ни прочитать из БД.
    for (const type of WIDGET_TYPES) {
      expect(configSchemaFor(type)).toBeDefined();
      expect(() => defaultWidgetConfig(type)).not.toThrow();
    }
  });

  it('дефолтный конфиг проходит собственную схему', () => {
    for (const type of WIDGET_TYPES) {
      expect(widgetConfigSchema.safeParse(defaultWidgetConfig(type)).success).toBe(true);
    }
  });

  it('отвергает неизвестный тип', () => {
    expect(widgetConfigSchema.safeParse({ type: 'poll', config: {} }).success).toBe(false);
  });

  it('знает, у каких типов есть состояние', () => {
    // У алертов и чата его нет: их «состояние» — поток событий. Дашборд по
    // этому признаку решает, показывать ли блок управления и запрашивать ли
    // снимок, которого у виджета не бывает.
    expect(hasWidgetState('goal')).toBe(true);
    expect(hasWidgetState('timer')).toBe(true);
    expect(hasWidgetState('top-donors')).toBe(true);
    expect(hasWidgetState('alerts')).toBe(false);
    expect(hasWidgetState('chat')).toBe(false);
  });

  it('проверяет конфиг схемой своего типа, а не любой', () => {
    // Отрицательная цель невозможна, и поймать это обязана ветка goal.
    expect(
      widgetConfigSchema.safeParse({ type: 'goal', config: { targetMinor: -5 } }).success,
    ).toBe(false);
    // А вот лишние поля схема отбрасывает, а не отвергает: так устроен разбор
    // во всём проекте — наружу уходит ровно то, что описано схемой.
    const parsed = widgetConfigSchema.parse({ type: 'goal', config: { durationMs: 9000 } });
    expect(parsed.config).not.toHaveProperty('durationMs');
  });

  it('цель начинает считать с момента создания, а не с начала времён', () => {
    // Иначе цель, подключённая сегодня, задним числом соберёт всё, что пришло
    // за год, и окажется выполненной ещё до первого доната.
    const config = defaultWidgetConfig('goal').config as { startedAt: string };
    expect(Date.now() - new Date(config.startedAt).getTime()).toBeLessThan(5000);
  });
});

describe('секунды за донат', () => {
  it('считает по мажорной единице валюты', () => {
    // 500 рублей при ставке 2 секунды за рубль.
    expect(donationSeconds(50_000, 2)).toBe(1000);
  });

  it('округляет вниз и не выдумывает дробных секунд', () => {
    // Правило 1 репозитория распространяется и на производные от сумм:
    // ни одного float ни на каком этапе.
    expect(donationSeconds(99, 1)).toBe(0);
    expect(donationSeconds(150, 1)).toBe(1);
    expect(Number.isInteger(donationSeconds(12_345, 7))).toBe(true);
  });

  it('ничего не добавляет при нулевой ставке или пустой сумме', () => {
    expect(donationSeconds(100_000, 0)).toBe(0);
    expect(donationSeconds(0, 10)).toBe(0);
    expect(donationSeconds(-500, 10)).toBe(0);
  });
});

describe('прогресс цели', () => {
  it('считает долю от цели', () => {
    expect(goalProgress({ raisedMinor: 25_000, targetMinor: 100_000 })).toBe(0.25);
  });

  it('не выходит за единицу при перевыполнении', () => {
    // Шкала кончается на ста процентах; сама сумма при этом показывается как есть.
    expect(goalProgress({ raisedMinor: 300_000, targetMinor: 100_000 })).toBe(1);
  });
});

describe('остаток таймера', () => {
  const now = new Date('2026-09-12T12:00:00.000Z').getTime();

  it('считается от момента окончания, а не от счётчика', () => {
    expect(
      timerRemainingSeconds(
        {
          kind: 'timer',
          endsAt: '2026-09-12T12:01:30.000Z',
          pausedSeconds: null,
          serverNow: '',
          currency: 'RUB',
        },
        now,
      ),
    ).toBe(90);
  });

  it('учитывает расхождение часов машины с OBS', () => {
    // Без поправки таймер в эфире врёт ровно на разницу часов, и заметить это
    // можно только сравнив с чужим экраном.
    expect(
      timerRemainingSeconds(
        {
          kind: 'timer',
          endsAt: '2026-09-12T12:01:30.000Z',
          pausedSeconds: null,
          serverNow: '',
          currency: 'RUB',
        },
        now,
        30_000,
      ),
    ).toBe(60);
  });

  it('на паузе отдаёт сохранённый остаток', () => {
    expect(
      timerRemainingSeconds(
        { kind: 'timer', endsAt: null, pausedSeconds: 42, serverNow: '', currency: 'RUB' },
        now + 10_000_000,
      ),
    ).toBe(42);
  });

  it('не уходит в минус после окончания', () => {
    expect(
      timerRemainingSeconds(
        {
          kind: 'timer',
          endsAt: '2026-09-12T11:00:00.000Z',
          pausedSeconds: null,
          serverNow: '',
          currency: 'RUB',
        },
        now,
      ),
    ).toBe(0);
  });
});

describe('формат длительности', () => {
  it('дополняет нулями', () => {
    expect(formatDuration(3661)).toBe('01:01:01');
  });

  it('прячет часы, когда их не просили и когда их нет', () => {
    expect(formatDuration(125, false)).toBe('02:05');
    // А вот когда час набрался — показывает, иначе 01:00:05 стало бы 00:05.
    expect(formatDuration(3605, false)).toBe('01:00:05');
  });
});

describe('продвинутое оформление', () => {
  const PRO = { advancedStyling: true };
  const FREE = { advancedStyling: false };

  it('слоты и фон по умолчанию пустые — виджет выглядит как до раскладки', () => {
    const goal = defaultWidgetConfig('goal').config as GoalWidgetConfig;
    expect(goal.slots.title).toEqual(EMPTY_SLOT);
    expect(goal.slots.bar.x).toBeNull();
    expect(goal.background).toEqual(EMPTY_BACKGROUND);
  });

  it('позиция — проценты кадра: за сотню не пускает', () => {
    const ok = goalWidgetConfigSchema.safeParse({ slots: { title: { x: 50, y: 12.5 } } });
    expect(ok.success).toBe(true);
    expect(goalWidgetConfigSchema.safeParse({ slots: { title: { x: 101 } } }).success).toBe(false);
    expect(goalWidgetConfigSchema.safeParse({ slots: { title: { y: -1 } } }).success).toBe(false);
  });

  it('у каждого типа с раскладкой свои элементы, и они есть в схеме', () => {
    for (const [type, slots] of Object.entries(WIDGET_SLOTS)) {
      const config = defaultWidgetConfig(type as WidgetType).config as {
        slots?: Record<string, unknown>;
      };
      // Алерты держат слоты в сценариях: оформление у них на тип события.
      const actual = type === 'alerts' ? ALERT_SLOTS : Object.keys(config.slots ?? {});
      expect([...actual].sort()).toEqual([...slots].sort());
    }
  });

  it('незнакомый шрифт из старого конфига подменяется, а не ломает чтение', () => {
    const config = goalWidgetConfigSchema.parse({ text: { fontFamily: 'Arial' } });
    expect(config.text.fontFamily).toBe('Inter');
    expect(goalWidgetConfigSchema.parse({ text: { fontFamily: 'Caveat' } }).text.fontFamily).toBe(
      'Caveat',
    );
  });

  it('без тарифа «Про» позиции, цвета, фон, картинки и шрифт снимаются', () => {
    const configured = goalWidgetConfigSchema.parse({
      slots: { title: { x: 10, y: 20, color: '#FF0000', fontSize: 64 } },
      background: { imageUrl: 'https://example.com/bg.png', color: '#101010', opacity: 0.5 },
      barImageUrl: 'https://example.com/bar.png',
      trackImageUrl: 'https://example.com/track.png',
      text: { fontFamily: 'Oswald', color: '#00FF00' },
    });

    const basic = applyPlanToConfig(configured, FREE);
    expect(basic.slots.title).toEqual(EMPTY_SLOT);
    expect(basic.background).toEqual(EMPTY_BACKGROUND);
    expect(basic.barImageUrl).toBeNull();
    expect(basic.trackImageUrl).toBeNull();
    expect(basic.text.fontFamily).toBe('Inter');
    // Всё, что не относится к продвинутому оформлению, остаётся как есть: цвет
    // текста стример настраивал и на бесплатном тарифе.
    expect(basic.text.color).toBe('#00FF00');
    expect(basic.title).toBe(configured.title);

    // Настройки не удалены: с тарифом возвращается ровно то же, что было.
    expect(applyPlanToConfig(configured, PRO)).toEqual(configured);
  });

  it('продвинутая анимация заменяется базовой, а не выбрасывается', () => {
    const configured = alertWidgetConfigSchema.parse({
      scenarios: {
        donation: { animationIn: 'flip', animationOut: 'shake', slots: { title: { x: 5 } } },
      },
    });
    const basic = applyPlanToConfig(configured, FREE);
    expect(basic.scenarios.donation.animationIn).toBe('zoom');
    expect(basic.scenarios.donation.animationOut).toBe('bounce');
    expect(basic.scenarios.donation.slots.title).toEqual(EMPTY_SLOT);
    // Базовые анимации остаются собой.
    expect(basic.scenarios.follow.animationIn).toBe('slide-up');
  });

  it('базовых анимаций пять, и все они есть в общем списке', () => {
    expect(BASIC_ALERT_ANIMATIONS).toHaveLength(5);
    for (const animation of BASIC_ALERT_ANIMATIONS) {
      expect(ALERT_ANIMATIONS).toContain(animation);
    }
    // Продвинутых тоже есть — иначе тариф нечем наполнить.
    expect(ALERT_ANIMATIONS.length).toBeGreaterThan(BASIC_ALERT_ANIMATIONS.length);
  });
});
