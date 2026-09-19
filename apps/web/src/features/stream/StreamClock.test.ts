import { describe, expect, it } from 'vitest';
import { formatDuration } from './StreamClock';

describe('время эфира', () => {
  it('часы без ведущего нуля, минуты и секунды — с ним', () => {
    expect(formatDuration((1 * 3600 + 2 * 60 + 3) * 1000)).toBe('1:02:03');
  });

  it('марафон длиннее суток не превращается в дни', () => {
    expect(formatDuration(26 * 3600 * 1000)).toBe('26:00:00');
  });

  it('часы стримера чуть впереди площадки — ноль, а не минус', () => {
    expect(formatDuration(-1500)).toBe('0:00:00');
  });
});
