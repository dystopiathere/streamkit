import { describe, expect, it } from 'vitest';
import { streamStartedAt, totalViewers } from './stream.js';

describe('окно эфира', () => {
  it('время стрима — от самого раннего идущего эфира', () => {
    expect(
      streamStartedAt([
        { isLive: true, liveSince: '2026-09-18T18:02:00.000Z' },
        { isLive: true, liveSince: '2026-09-18T18:00:30.000Z' },
        // Закончившийся эфир не считается, даже если начался раньше.
        { isLive: false, liveSince: '2026-09-18T12:00:00.000Z' },
      ]),
    ).toBe('2026-09-18T18:00:30.000Z');
  });

  it('без идущих эфиров времени стрима нет', () => {
    expect(streamStartedAt([{ isLive: false, liveSince: null }])).toBeNull();
    expect(streamStartedAt([{ isLive: true, liveSince: null }])).toBeNull();
  });

  it('зрители складываются только по идущим эфирам', () => {
    expect(
      totalViewers([
        { isLive: true, viewers: 120 },
        { isLive: true, viewers: 30 },
        { isLive: false, viewers: null },
      ]),
    ).toBe(150);
  });

  it('«неизвестно» не превращается в ноль', () => {
    expect(totalViewers([{ isLive: true, viewers: null }])).toBeNull();
    expect(totalViewers([])).toBeNull();
  });
});
