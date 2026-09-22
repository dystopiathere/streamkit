import { describe, expect, it } from 'vitest';
import { eventsPageQuerySchema, webhookAlertPayloadSchema } from './events.js';
import {
  alertVoiceDurationMs,
  alertVoiceUrl,
  alertWidgetConfigSchema,
  alertTriggerSchema,
  applyPlanToConfig,
  donationSpins,
  latestWidgetConfigSchema,
  matchAlertTrigger,
  matchesTriggerCondition,
  pickRouletteSector,
  resolveAlertScenario,
  ROULETTE_COLORS,
  rouletteGeometry,
  rouletteSectorColor,
  rouletteWidgetConfigSchema,
  type AlertTriggerCondition,
} from './widgets.js';

const rub = (amountMinor: number) => ({ amountMinor, currency: 'RUB' as const });
const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' as const });

function condition(partial: Partial<AlertTriggerCondition>): AlertTriggerCondition {
  return { operator: 'gte', currency: 'RUB', amountMinor: 100_000, toMinor: null, ...partial };
}

function trigger(id: string, cond: Partial<AlertTriggerCondition>, titleTemplate = id) {
  return alertTriggerSchema.parse({ id, condition: condition(cond), titleTemplate });
}

describe('условие триггера', () => {
  it.each([
    ['gte', 100_000, true],
    ['gte', 99_999, false],
    ['gt', 100_000, false],
    ['gt', 100_001, true],
    ['eq', 100_000, true],
    ['eq', 100_100, false],
    ['lte', 100_000, true],
    ['lte', 100_001, false],
    ['lt', 99_999, true],
    ['lt', 100_000, false],
  ] as const)('%s 1000 ₽ при донате %i коп. — %s', (operator, amountMinor, expected) => {
    expect(matchesTriggerCondition(condition({ operator }), rub(amountMinor))).toBe(expected);
  });

  it('«между» — включительно с обеих сторон', () => {
    const between = condition({ operator: 'between', amountMinor: 50_000, toMinor: 99_900 });
    expect(matchesTriggerCondition(between, rub(50_000))).toBe(true);
    expect(matchesTriggerCondition(between, rub(99_900))).toBe(true);
    expect(matchesTriggerCondition(between, rub(99_901))).toBe(false);
    expect(matchesTriggerCondition(between, rub(49_999))).toBe(false);
  });

  it('донат в другой валюте и без суммы триггер не ловит: курс не считаем', () => {
    expect(
      matchesTriggerCondition(condition({}), { amountMinor: 1_000_000, currency: 'USD' }),
    ).toBe(false);
    expect(matchesTriggerCondition(condition({}), null)).toBe(false);
  });

  it('«между» без верхней границы схема не принимает', () => {
    expect(
      alertTriggerSchema.safeParse({
        id: 't',
        condition: { operator: 'between', amountMinor: 1000, toMinor: null },
      }).success,
    ).toBe(false);
    expect(
      alertTriggerSchema.safeParse({
        id: 't',
        condition: { operator: 'between', amountMinor: 1000, toMinor: 500 },
      }).success,
    ).toBe(false);
  });
});

describe('приоритет триггеров', () => {
  // Пример из постановки: сначала ровно 1000, потом «меньше 10 000»; от 500 —
  // ниже по приоритету.
  const scenario = alertWidgetConfigSchema.parse({
    scenarios: {
      donation: {
        titleTemplate: 'обычный',
        triggers: [
          trigger('exact', { operator: 'eq', amountMinor: 100_000 }),
          trigger('under', { operator: 'lt', amountMinor: 1_000_000 }),
          trigger('from500', { operator: 'gte', amountMinor: 50_000 }),
        ],
      },
    },
  }).scenarios.donation;

  it('срабатывает первый подошедший, а не самый точный', () => {
    expect(matchAlertTrigger(scenario, { amount: rub(100_000) })?.id).toBe('exact');
    // 700 ₽ подходит и под «меньше 10 000», и под «от 500» — берётся тот, что выше.
    expect(matchAlertTrigger(scenario, { amount: rub(70_000) })?.id).toBe('under');
    // От 10 000 ₽ ловит «от 500» — стоит ниже, но условие шире.
    expect(matchAlertTrigger(scenario, { amount: rub(2_000_000) })?.id).toBe('from500');
    expect(matchAlertTrigger(scenario, { amount: usd(2_000_000) })).toBeNull();
  });

  it('ни один не подошёл — вид самого сценария', () => {
    expect(resolveAlertScenario(scenario, { amount: usd(2_000_000) }).titleTemplate).toBe(
      'обычный',
    );
  });

  it('вид берётся из триггера, пороги и включение — из сценария', () => {
    const resolved = resolveAlertScenario(
      { ...scenario, minAmounts: { RUB: 10_000 } },
      { amount: rub(100_000) },
    );
    expect(resolved.titleTemplate).toBe('exact');
    expect(resolved.minAmounts).toEqual({ RUB: 10_000 });
    expect(resolved.enabled).toBe(true);
    expect(resolved.triggers).toHaveLength(3);
  });

  it('сохранённые до триггеров сценарии читаются с пустым списком', () => {
    expect(alertWidgetConfigSchema.parse({}).scenarios.donation.triggers).toEqual([]);
  });

  it('тариф снимает продвинутое оформление и с триггеров', () => {
    const config = alertWidgetConfigSchema.parse({
      scenarios: {
        donation: {
          triggers: [
            {
              ...trigger('styled', {}),
              background: { color: '#FF0000' },
              slots: { title: { x: 10, y: 10 } },
              animationIn: 'flip',
            },
          ],
        },
      },
    });
    const basic = applyPlanToConfig(config, { advancedStyling: false });
    const styled = basic.scenarios.donation.triggers[0]!;
    expect(styled.background.color).toBeNull();
    expect(styled.slots.title.x).toBeNull();
    expect(styled.animationIn).toBe('zoom');
    // В базе оформление осталось — урезание на выходе.
    expect(config.scenarios.donation.triggers[0]!.background.color).toBe('#FF0000');
  });
});

describe('рулетка', () => {
  it('сектор выбирается по весам', () => {
    const sectors = [{ weight: 1 }, { weight: 3 }];
    expect(pickRouletteSector(sectors, 0)).toBe(0);
    expect(pickRouletteSector(sectors, 0.249)).toBe(0);
    expect(pickRouletteSector(sectors, 0.25)).toBe(1);
    expect(pickRouletteSector(sectors, 0.999999)).toBe(1);
    // Крайние значения генератора не выводят за колесо.
    expect(pickRouletteSector(sectors, 1)).toBe(1);
    expect(pickRouletteSector(sectors, -1)).toBe(0);
  });

  it('доля круга у сектора — доля его веса', () => {
    expect(rouletteGeometry([{ weight: 1 }, { weight: 3 }])).toEqual([
      { start: 0, end: 90 },
      { start: 90, end: 360 },
    ]);
  });

  it('донат крутит колесо от цены своей валюты, без курса', () => {
    const config = rouletteWidgetConfigSchema.parse({ spinPrice: { RUB: 30_000 } });
    expect(donationSpins(config, rub(30_000))).toBe(true);
    expect(donationSpins(config, rub(29_999))).toBe(false);
    // Валюта без цены не крутит: пустая цена крутила бы на копейку.
    expect(donationSpins(config, { amountMinor: 1_000_000, currency: 'USD' })).toBe(false);
    expect(donationSpins({ ...config, spinPrice: { RUB: 0 } }, rub(1_000_000))).toBe(false);
    expect(donationSpins({ ...config, donationSpins: false }, rub(1_000_000))).toBe(false);
    expect(donationSpins(config, null)).toBe(false);
  });

  it('меньше двух секторов — не колесо', () => {
    expect(
      rouletteWidgetConfigSchema.safeParse({
        sectors: [{ id: 'a', label: 'Один', weight: 1, color: '#FFFFFF' }],
      }).success,
    ).toBe(false);
  });

  it('новый виджет получает шесть секторов, соседние — разных цветов', () => {
    const { sectors } = rouletteWidgetConfigSchema.parse({});
    expect(sectors).toHaveLength(6);
    sectors.forEach((sector, index) => {
      const next = sectors[(index + 1) % sectors.length]!;
      expect(sector.color).not.toBe(next.color);
    });
  });

  it('цвет последнего сектора не совпадает с первым и заменяется на стыке кольца', () => {
    for (let count = 2; count <= 24; count += 1) {
      const colors = Array.from({ length: count }, (_, index) => rouletteSectorColor(index, count));
      expect(colors.at(-1)).not.toBe(colors[0]);
      expect(colors.at(-1)).not.toBe(colors.at(-2));
    }
    // Проверенные валидатором замены: при трёх секторах красный уступает
    // голубому, при девяти повтор первого — синему.
    expect(rouletteSectorColor(2, 3)).toBe(ROULETTE_COLORS[3]);
    expect(rouletteSectorColor(8, 9)).toBe(ROULETTE_COLORS[1]);
    expect(rouletteSectorColor(2, 5)).toBe(ROULETTE_COLORS[2]);
  });
});

describe('последнее событие', () => {
  it('по умолчанию — донат с его шаблоном', () => {
    const config = latestWidgetConfigSchema.parse({});
    expect(config.eventType).toBe('donation');
    expect(config.template).toBe('{username} — {amount}');
    expect(config.canvas).toEqual({ width: 800, height: 600 });
  });
});

describe('страница истории событий', () => {
  it('размер страницы — только из списка', () => {
    expect(eventsPageQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
    expect(eventsPageQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false);
    expect(eventsPageQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('голосовой донат', () => {
  const config = alertWidgetConfigSchema.parse({ voice: { maxSeconds: 30 } });
  const voice = 'https://cdn.example/voice.mp3';

  it('играет, только когда запись есть и голос не выключен', () => {
    expect(alertVoiceUrl(config, { audioUrl: voice })).toBe(voice);
    expect(alertVoiceUrl(config, { audioUrl: null })).toBeNull();
    expect(
      alertVoiceUrl(alertWidgetConfigSchema.parse({ voice: { enabled: false } }), {
        audioUrl: voice,
      }),
    ).toBeNull();
  });

  it('ссылка на запись принимается только по https: её играет браузер-сорс', () => {
    const payload = { externalId: '1', username: 'Аня' };
    expect(webhookAlertPayloadSchema.parse(payload).audioUrl).toBeNull();
    expect(webhookAlertPayloadSchema.parse({ ...payload, audioUrl: voice }).audioUrl).toBe(voice);
    expect(
      webhookAlertPayloadSchema.safeParse({ ...payload, audioUrl: 'http://cdn/voice.mp3' }).success,
    ).toBe(false);
  });

  it('оповещение держится, пока звучит запись, но не дольше потолка', () => {
    // Короткая запись не сокращает показ сценария.
    expect(alertVoiceDurationMs(config, 6000, 2)).toBe(6000);
    // Длинная — продлевает, с хвостом в полсекунды.
    expect(alertVoiceDurationMs(config, 6000, 10)).toBe(10_500);
    // Потолок сильнее записи: её длину задаёт донатер.
    expect(alertVoiceDurationMs(config, 6000, 120)).toBe(30_000);
  });
});
