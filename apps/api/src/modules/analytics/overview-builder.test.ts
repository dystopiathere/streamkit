import { describe, expect, it } from 'vitest';
import { buildOverview, type ChannelSession } from './overview-builder';

const at = (time: string): Date => new Date(`2026-09-20T${time}:00Z`);

function session(overrides: Partial<ChannelSession>): ChannelSession {
  return {
    channelId: 'twitch-1',
    platform: 'twitch',
    startedAt: at('18:00'),
    endedAt: at('19:59'),
    peakViewers: 100,
    avgViewers: 60.4,
    audienceFirst: 1000,
    audienceLast: 1010,
    ...overrides,
  };
}

describe('buildOverview', () => {
  it('склеивает мультистрим в один эфир и складывает зрителей площадок', () => {
    const { streams } = buildOverview({
      boundaries: [at('00:00')],
      now: at('23:00'),
      donations: [],
      events: [],
      sessions: [
        session({}),
        session({
          channelId: 'youtube-1',
          platform: 'youtube',
          startedAt: at('18:05'),
          endedAt: at('20:09'),
          peakViewers: 40,
          avgViewers: 20,
          audienceFirst: 500,
          audienceLast: 503,
        }),
      ],
      audience: [],
    });

    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({
      platforms: ['twitch', 'youtube'],
      minutes: 130,
      peakViewers: 140,
      avgViewers: 80,
      audienceGain: 13,
    });
  });

  it('держит эфир целым через короткий обрыв и режет через долгий перерыв', () => {
    const { streams } = buildOverview({
      boundaries: [at('00:00')],
      now: at('23:00'),
      donations: [],
      events: [],
      sessions: [
        session({ startedAt: at('10:00'), endedAt: at('10:59') }),
        session({ startedAt: at('11:10'), endedAt: at('11:59') }),
        session({ startedAt: at('15:00'), endedAt: at('15:59') }),
      ],
      audience: [],
    });

    expect(streams.map((stream) => stream.minutes)).toEqual([120, 60]);
  });

  it('раскладывает донаты по эфирам и корзинам, минуты эфира — по корзинам', () => {
    const result = buildOverview({
      boundaries: [at('00:00'), at('19:00')],
      now: at('23:00'),
      donations: [
        { at: at('12:00'), amountMinor: 10_000, count: 1 },
        { at: at('18:30'), amountMinor: 50_000, count: 2 },
        { at: at('19:30'), amountMinor: 25_000, count: 1 },
      ],
      events: [{ at: at('18:10'), amountMinor: 0, count: 3 }],
      sessions: [session({})],
      audience: [],
    });

    expect(result.buckets.map((bucket) => bucket.donationsMinor)).toEqual([60_000, 25_000]);
    expect(result.buckets.map((bucket) => bucket.liveMinutes)).toEqual([60, 60]);
    expect(result.streams[0]).toMatchObject({
      donationsMinor: 75_000,
      donationsCount: 3,
      events: 3,
    });
    // Донат днём, вне эфира, в «донаты во время эфиров» не идёт.
    expect(result.donationsDuringStreamsMinor).toBe(75_000);
  });

  it('считает прирост аудитории от конца прошлой корзины, а не с нуля', () => {
    const { buckets } = buildOverview({
      boundaries: [at('00:00'), at('12:00')],
      now: at('23:00'),
      donations: [],
      events: [],
      sessions: [],
      audience: [
        { channelId: 'twitch-1', at: at('00:00'), first: 1000, last: 1004 },
        { channelId: 'twitch-1', at: at('12:00'), first: 1003, last: 1010 },
        { channelId: 'youtube-1', at: at('12:00'), first: null, last: null },
      ],
    });

    expect(buckets.map((bucket) => bucket.audienceGain)).toEqual([4, 6]);
  });
});
