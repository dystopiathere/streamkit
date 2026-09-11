import { describe, expect, it } from 'vitest';
import {
  alertWidgetConfigSchema,
  defaultAlertWidgetConfig,
  renderTemplate,
  shouldShowAlert,
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
