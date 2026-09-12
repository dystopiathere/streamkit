import { describe, expect, it } from 'vitest';
import {
  alertWidgetConfigSchema,
  configSchemaFor,
  defaultAlertWidgetConfig,
  defaultWidgetConfig,
  donationSeconds,
  formatDuration,
  goalProgress,
  renderTemplate,
  shouldShowAlert,
  timerRemainingSeconds,
  WIDGET_TYPES,
  widgetConfigSchema,
} from './widgets.js';
import type { AlertEvent } from './events.js';

function event(
  overrides: Partial<AlertEvent> = {},
): Pick<AlertEvent, 'type' | 'amount' | 'isTest'> {
  return {
    type: 'donation',
    amount: { amountMinor: 10_000, currency: 'RUB' },
    isTest: false,
    ...overrides,
  };
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
  const config = { eventTypes: ['donation'] as const, minAmountMinor: 0 };

  it('показывает подходящее событие', () => {
    expect(shouldShowAlert(event(), { ...config, eventTypes: ['donation'] })).toBe(true);
  });

  it('отсекает тип события, не включённый в виджет', () => {
    expect(
      shouldShowAlert(event({ type: 'follow' }), { ...config, eventTypes: ['donation'] }),
    ).toBe(false);
  });

  it('отсекает донат ниже порога', () => {
    expect(
      shouldShowAlert(event({ amount: { amountMinor: 4_999, currency: 'RUB' } }), {
        eventTypes: ['donation'],
        minAmountMinor: 5_000,
      }),
    ).toBe(false);
  });

  it('пропускает донат ровно на пороге', () => {
    expect(
      shouldShowAlert(event({ amount: { amountMinor: 5_000, currency: 'RUB' } }), {
        eventTypes: ['donation'],
        minAmountMinor: 5_000,
      }),
    ).toBe(true);
  });

  it('отсекает событие без суммы, если порог задан', () => {
    expect(
      shouldShowAlert(event({ amount: null }), { eventTypes: ['donation'], minAmountMinor: 1 }),
    ).toBe(false);
  });

  it('пропускает событие без суммы, если порога нет', () => {
    expect(
      shouldShowAlert(event({ amount: null }), { eventTypes: ['donation'], minAmountMinor: 0 }),
    ).toBe(true);
  });

  it('тестовый алерт проходит любые фильтры — иначе стример не проверит настройку', () => {
    expect(
      shouldShowAlert(event({ type: 'raid', amount: null, isTest: true }), {
        eventTypes: ['donation'],
        minAmountMinor: 100_000,
      }),
    ).toBe(true);
  });
});

describe('alertWidgetConfigSchema', () => {
  it('заполняет дефолты из пустого объекта', () => {
    const config = defaultAlertWidgetConfig();
    expect(config.durationMs).toBe(6000);
    expect(config.eventTypes).toEqual(['donation']);
    expect(config.text.fontSize).toBe(32);
    expect(config.sound.enabled).toBe(false);
  });

  it('отклоняет http-ссылку на звук (смешанный контент в OBS)', () => {
    const result = alertWidgetConfigSchema.safeParse({
      sound: { enabled: true, url: 'http://example.com/a.mp3', volume: 0.5 },
    });
    expect(result.success).toBe(false);
  });

  it('отклоняет некорректный цвет', () => {
    const result = alertWidgetConfigSchema.safeParse({ text: { color: 'red' } });
    expect(result.success).toBe(false);
  });

  it('отклоняет пустой список типов событий', () => {
    const result = alertWidgetConfigSchema.safeParse({ eventTypes: [] });
    expect(result.success).toBe(false);
  });

  it('отклоняет отрицательный порог суммы', () => {
    const result = alertWidgetConfigSchema.safeParse({ minAmountMinor: -1 });
    expect(result.success).toBe(false);
  });
});

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
    expect(widgetConfigSchema.safeParse({ type: 'chat', config: {} }).success).toBe(false);
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
