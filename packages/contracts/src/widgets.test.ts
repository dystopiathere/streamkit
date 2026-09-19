import { describe, expect, it } from 'vitest';
import {
  alertWidgetConfigSchema,
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
    const config = withScenario('donation', { minAmountMinor: 5_000 });
    const donation = (amountMinor: number) => event({ amount: { amountMinor, currency: 'RUB' } });
    expect(shouldShowAlert(donation(4_999), config)).toBe(false);
    expect(shouldShowAlert(donation(5_000), config)).toBe(true);
    expect(shouldShowAlert(event({ amount: null }), config)).toBe(false);
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
      scenarios: { donation: { minAmountMinor: 100_000 }, raid: { enabled: false } },
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
    expect(withScenarioResult({ minAmountMinor: -1 })).toBe(false);
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
        { kind: 'timer', endsAt: '2026-09-12T12:01:30.000Z', pausedSeconds: null, serverNow: '' },
        now,
      ),
    ).toBe(90);
  });

  it('учитывает расхождение часов машины с OBS', () => {
    // Без поправки таймер в эфире врёт ровно на разницу часов, и заметить это
    // можно только сравнив с чужим экраном.
    expect(
      timerRemainingSeconds(
        { kind: 'timer', endsAt: '2026-09-12T12:01:30.000Z', pausedSeconds: null, serverNow: '' },
        now,
        30_000,
      ),
    ).toBe(60);
  });

  it('на паузе отдаёт сохранённый остаток', () => {
    expect(
      timerRemainingSeconds(
        { kind: 'timer', endsAt: null, pausedSeconds: 42, serverNow: '' },
        now + 10_000_000,
      ),
    ).toBe(42);
  });

  it('не уходит в минус после окончания', () => {
    expect(
      timerRemainingSeconds(
        { kind: 'timer', endsAt: '2026-09-12T11:00:00.000Z', pausedSeconds: null, serverNow: '' },
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
