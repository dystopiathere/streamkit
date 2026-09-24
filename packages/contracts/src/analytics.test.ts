import { describe, expect, it } from 'vitest';
import {
  analyticsQuerySchema,
  channelStatsSchema,
  donationTotalSchema,
  rangeBucket,
  rangeToMs,
} from './analytics.js';

describe('диапазоны аналитики', () => {
  it('переводит диапазон в миллисекунды', () => {
    expect(rangeToMs('24h')).toBe(24 * 60 * 60 * 1000);
    expect(rangeToMs('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(rangeToMs('30d')).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('прореживает месяц по суткам, короткие диапазоны — по часам', () => {
    // Месяц минутных снимков — это под сорок тысяч точек. Часовые корзины
    // оставили бы 720 штук на график шириной в тысячу пикселей.
    expect(rangeBucket('30d')).toBe('day');
    expect(rangeBucket('90d')).toBe('day');
    expect(rangeBucket('7d')).toBe('hour');
    expect(rangeBucket('24h')).toBe('hour');
  });

  it('подставляет неделю, когда диапазон не указан', () => {
    expect(analyticsQuerySchema.parse({}).range).toBe('7d');
  });

  it('отклоняет произвольный диапазон', () => {
    expect(analyticsQuerySchema.safeParse({ range: '1y' }).success).toBe(false);
  });
});

describe('channelStatsSchema', () => {
  const base = {
    capturedAt: new Date().toISOString(),
    isLive: true,
    viewers: 120,
    followers: 3400,
    subscribers: 55,
    totalViews: 1_200_000,
    title: 'Стрим',
    category: 'Dota 2',
    liveSince: '2026-09-12T08:30:00.000Z',
  };

  it('принимает снимок со всеми показателями', () => {
    expect(channelStatsSchema.safeParse(base).success).toBe(true);
  });

  it('допускает пустые показатели: площадки отдают разные наборы', () => {
    // У YouTube нет фолловеров, у Twitch — суммарных просмотров. Требовать
    // число там, где его не существует, значит заставить выдумать ноль.
    const result = channelStatsSchema.safeParse({
      ...base,
      followers: null,
      totalViews: null,
      viewers: null,
      isLive: false,
    });
    expect(result.success).toBe(true);
  });

  it('отклоняет отрицательное число зрителей', () => {
    expect(channelStatsSchema.safeParse({ ...base, viewers: -1 }).success).toBe(false);
  });

  it('отклоняет дробное число подписчиков', () => {
    expect(channelStatsSchema.safeParse({ ...base, subscribers: 10.5 }).success).toBe(false);
  });
});

describe('donationTotalSchema', () => {
  it('принимает целую сумму в минорных единицах', () => {
    expect(
      donationTotalSchema.safeParse({ currency: 'RUB', amountMinor: 150_000, count: 3 }).success,
    ).toBe(true);
  });

  it('отклоняет дробную сумму: деньги только целыми минорными единицами', () => {
    expect(
      donationTotalSchema.safeParse({ currency: 'RUB', amountMinor: 1500.5, count: 3 }).success,
    ).toBe(false);
  });

  it('отклоняет неизвестную валюту', () => {
    expect(
      donationTotalSchema.safeParse({ currency: 'BTC', amountMinor: 1, count: 1 }).success,
    ).toBe(false);
  });
});

describe('часовой пояс в запросе ряда', () => {
  it('принимает зону IANA', () => {
    expect(analyticsQuerySchema.parse({ timeZone: 'Europe/Moscow' }).timeZone).toBe(
      'Europe/Moscow',
    );
  });

  it('подставляет UTC, когда зона не прислана', () => {
    // Старый клиент зону не шлёт, и его ответ меняться не должен.
    expect(analyticsQuerySchema.parse({}).timeZone).toBe('UTC');
  });

  it('отвергает выдуманную зону', () => {
    // До SQL такое доехать не должно: там неизвестная зона станет ошибкой
    // запроса, то есть пятисоткой вместо внятного 400.
    expect(analyticsQuerySchema.safeParse({ timeZone: 'Europe/Мосва' }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ timeZone: "'; DROP TABLE" }).success).toBe(false);
  });
});
