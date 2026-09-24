import { describe, expect, it } from 'vitest';
import type { OverviewBucket, StreamSession } from './analytics.js';
import {
  compareStreamDays,
  correlationStrength,
  divideRounded,
  donationsPerLiveHour,
  spearman,
} from './analytics-insights.js';

describe('divideRounded', () => {
  it('округляет половину вверх и остаётся целым', () => {
    expect(divideRounded(10, 4)).toBe(3);
    expect(divideRounded(9, 4)).toBe(2);
    expect(divideRounded(-10, 4)).toBe(-3);
    expect(divideRounded(0, 7)).toBe(0);
  });

  it('не делит на ноль и не принимает дроби', () => {
    expect(() => divideRounded(1, 0)).toThrow(RangeError);
    expect(() => divideRounded(1.5, 2)).toThrow(RangeError);
  });
});

describe('spearman', () => {
  it('видит монотонную связь, даже нелинейную', () => {
    expect(spearman([1, 2, 3, 4], [10, 100, 1000, 10_000])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });

  it('не даёт одному выбросу решить за весь месяц', () => {
    // Пирсон здесь ~0.99 из-за одного огромного доната; ранги видят, что в
    // остальные эфиры связи нет.
    const hours = [1, 2, 3, 4, 5, 6];
    const donations = [500, 400, 300, 200, 100, 1_000_000];
    expect(spearman(hours, donations)).toBeLessThan(0.1);
  });

  it('молчит, когда пар мало или величина не меняется', () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNull();
  });

  it('делит ранг поровну между равными значениями', () => {
    expect(spearman([1, 1, 2, 3], [1, 1, 2, 3])).toBeCloseTo(1);
  });
});

describe('correlationStrength', () => {
  it('называет силу по модулю', () => {
    expect(correlationStrength(0.1)).toBe('none');
    expect(correlationStrength(-0.3)).toBe('weak');
    expect(correlationStrength(0.5)).toBe('moderate');
    expect(correlationStrength(-0.9)).toBe('strong');
  });
});

function day(
  liveMinutes: number,
  donationsMinor: number,
  audienceGain: number | null,
): OverviewBucket {
  return {
    at: new Date().toISOString(),
    liveMinutes,
    donationsMinor,
    donationsCount: 0,
    audienceGain,
  };
}

describe('compareStreamDays', () => {
  it('сравнивает средние дней с эфиром и без', () => {
    const result = compareStreamDays([
      day(120, 10_000, 5),
      day(0, 1_000, 1),
      day(60, 20_001, null),
      day(0, 0, 0),
    ]);
    expect(result).toEqual({
      streamDays: 2,
      offDays: 2,
      donationsPerStreamDay: 15_001,
      donationsPerOffDay: 500,
      audiencePerStreamDay: 5,
      audiencePerOffDay: 1,
    });
  });

  it('говорит «неизвестно», а не ноль, когда дней нет', () => {
    const result = compareStreamDays([day(0, 100, null)]);
    expect(result.donationsPerStreamDay).toBeNull();
    expect(result.audiencePerOffDay).toBeNull();
  });
});

describe('donationsPerLiveHour', () => {
  const stream = (minutes: number, donationsMinor: number): StreamSession => ({
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    minutes,
    platforms: ['twitch'],
    peakViewers: null,
    avgViewers: null,
    donationsMinor,
    donationsCount: 0,
    audienceGain: null,
    events: 0,
  });

  it('считает по донатам во время эфиров', () => {
    expect(donationsPerLiveHour([stream(90, 30_000), stream(30, 0)])).toBe(15_000);
  });

  it('без эфиров — неизвестно', () => {
    expect(donationsPerLiveHour([])).toBeNull();
  });
});
