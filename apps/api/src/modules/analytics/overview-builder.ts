import {
  type OverviewBucket,
  type Platform,
  PLATFORM_COUNTERS,
  type StreamSession,
} from '@streamkit/contracts';

/**
 * Сколько «не в эфире» между снимками ещё считается тем же эфиром.
 *
 * Пятнадцать минут — это перезапуск воркера, отказ площадки на пару тактов или
 * стример, перезапустивший трансляцию после обрыва: зрители видят это как один
 * эфир, и в сводке он должен остаться одним, а не двумя короткими.
 */
export const STREAM_BREAK_MS = 15 * 60 * 1000;

/**
 * Снимок в эфире означает минуту эфира после него: опрос в эфире идёт раз в
 * минуту. Без этой минуты эфир из одного снимка длился бы ноль минут, а любой
 * эфир — на минуту короче, чем был.
 */
export const LIVE_SAMPLE_MS = 60 * 1000;

/** Непрерывный эфир одного канала, как его отдаёт запрос по снимкам. */
export interface ChannelSession {
  channelId: string;
  platform: Platform;
  startedAt: Date;
  endedAt: Date;
  peakViewers: number | null;
  avgViewers: number | null;
  /** Счётчик аудитории площадки (`PLATFORM_COUNTERS.audience`) в начале и конце. */
  audienceFirst: number | null;
  audienceLast: number | null;
}

/** Первое и последнее значение счётчика аудитории канала в корзине. */
export interface ChannelAudienceBucket {
  channelId: string;
  at: Date;
  first: number | null;
  last: number | null;
}

/** Донаты или события, сложенные по минуте прихода. */
export interface MinuteSum {
  at: Date;
  amountMinor: number;
  count: number;
}

export interface OverviewInput {
  /** Начала корзин по местному времени, по возрастанию; конец последней — `now`. */
  boundaries: Date[];
  now: Date;
  donations: MinuteSum[];
  /** События без суммы: фолловы, подписки, подарки, рейды, биты, награды. */
  events: MinuteSum[];
  sessions: ChannelSession[];
  audience: ChannelAudienceBucket[];
}

export interface OverviewResult {
  buckets: OverviewBucket[];
  streams: StreamSession[];
  donationsDuringStreamsMinor: number;
}

/**
 * Какой счётчик мерит аудиторию у площадки — для запроса по снимкам. null —
 * у площадки его нет (Kick), и в прирост аудитории она не входит.
 */
export function audienceCounter(platform: Platform): 'followers' | 'subscribers' | null {
  const counter = PLATFORM_COUNTERS[platform].audience;
  if (counter === null) return null;
  return counter === 'followers' ? 'followers' : 'subscribers';
}

interface MergedStream {
  start: number;
  /** Конец эфира с минутой последнего снимка. */
  end: number;
  sessions: ChannelSession[];
}

/**
 * Эфиры всех каналов, склеенные в общие отрезки.
 *
 * Мультистрим — один эфир: Twitch и YouTube идут одновременно, а донат про
 * площадку ничего не знает и между ними не делится.
 */
function mergeSessions(sessions: readonly ChannelSession[]): MergedStream[] {
  const sorted = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const merged: MergedStream[] = [];
  for (const session of sorted) {
    const start = session.startedAt.getTime();
    const end = session.endedAt.getTime() + LIVE_SAMPLE_MS;
    const last = merged[merged.length - 1];
    if (last && start - last.end <= STREAM_BREAK_MS) {
      last.end = Math.max(last.end, end);
      last.sessions.push(session);
    } else {
      merged.push({ start, end, sessions: [session] });
    }
  }
  return merged;
}

/** Сумма по каналам: у каждого канала — максимум его отрезков внутри эфира. */
function sumPerChannel(
  sessions: readonly ChannelSession[],
  pick: (session: ChannelSession) => number | null,
): number | null {
  const perChannel = new Map<string, number>();
  for (const session of sessions) {
    const value = pick(session);
    if (value === null) continue;
    perChannel.set(session.channelId, Math.max(perChannel.get(session.channelId) ?? 0, value));
  }
  if (perChannel.size === 0) return null;
  return [...perChannel.values()].reduce((sum, value) => sum + value, 0);
}

/** Прирост аудитории за эфир: по каждому отрезку «конец минус начало». */
function audienceGain(sessions: readonly ChannelSession[]): number | null {
  let known = false;
  let gain = 0;
  for (const session of sessions) {
    if (session.audienceFirst === null || session.audienceLast === null) continue;
    known = true;
    gain += session.audienceLast - session.audienceFirst;
  }
  return known ? gain : null;
}

/** Номер корзины для момента: последняя граница не позже него. */
function bucketIndex(boundaries: readonly number[], at: number): number {
  let low = 0;
  let high = boundaries.length - 1;
  if (high < 0 || at < boundaries[0]!) return -1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (boundaries[middle]! <= at) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Сводка из того, что отдали запросы: корзины времени и эфиры.
 *
 * Отдельно от сервиса и без базы: здесь вся арифметика склейки и раскладки по
 * корзинам, и её удобно проверять юнит-тестом на придуманных снимках.
 */
export function buildOverview(input: OverviewInput): OverviewResult {
  const starts = input.boundaries.map((date) => date.getTime());
  const ends = starts.map((_, index) => starts[index + 1] ?? input.now.getTime());

  const buckets: OverviewBucket[] = input.boundaries.map((at) => ({
    at: at.toISOString(),
    donationsMinor: 0,
    donationsCount: 0,
    liveMinutes: 0,
    audienceGain: null,
  }));

  for (const donation of input.donations) {
    const index = bucketIndex(starts, donation.at.getTime());
    if (index < 0) continue;
    buckets[index]!.donationsMinor += donation.amountMinor;
    buckets[index]!.donationsCount += donation.count;
  }

  const merged = mergeSessions(input.sessions);
  const liveMs = new Array<number>(buckets.length).fill(0);
  for (const stream of merged) {
    for (let index = 0; index < buckets.length; index += 1) {
      const overlap = Math.min(stream.end, ends[index]!) - Math.max(stream.start, starts[index]!);
      if (overlap > 0) liveMs[index]! += overlap;
    }
  }
  liveMs.forEach((ms, index) => {
    buckets[index]!.liveMinutes = Math.round(ms / 60_000);
  });

  // Прирост в корзине — от последнего известного значения предыдущей: так
  // отписки и подписки на стыке корзин не теряются и не считаются дважды.
  const audienceByChannel = new Map<string, ChannelAudienceBucket[]>();
  for (const row of input.audience) {
    const rows = audienceByChannel.get(row.channelId) ?? [];
    rows.push(row);
    audienceByChannel.set(row.channelId, rows);
  }
  for (const rows of audienceByChannel.values()) {
    rows.sort((a, b) => a.at.getTime() - b.at.getTime());
    let previous: number | null = null;
    for (const row of rows) {
      const index = bucketIndex(starts, row.at.getTime());
      const base = previous ?? row.first;
      if (index >= 0 && base !== null && row.last !== null) {
        buckets[index]!.audienceGain = (buckets[index]!.audienceGain ?? 0) + (row.last - base);
      }
      if (row.last !== null) previous = row.last;
    }
  }

  const streams: StreamSession[] = merged.map((stream) => {
    const inside = (at: Date): boolean => at.getTime() >= stream.start && at.getTime() < stream.end;
    const donations = input.donations.filter((donation) => inside(donation.at));
    return {
      startedAt: new Date(stream.start).toISOString(),
      endedAt: new Date(stream.end).toISOString(),
      minutes: Math.round((stream.end - stream.start) / 60_000),
      platforms: [...new Set(stream.sessions.map((session) => session.platform))].sort(),
      peakViewers: sumPerChannel(stream.sessions, (session) => session.peakViewers),
      avgViewers: sumPerChannel(stream.sessions, (session) =>
        session.avgViewers === null ? null : Math.round(session.avgViewers),
      ),
      donationsMinor: donations.reduce((sum, donation) => sum + donation.amountMinor, 0),
      donationsCount: donations.reduce((sum, donation) => sum + donation.count, 0),
      audienceGain: audienceGain(stream.sessions),
      events: input.events
        .filter((event) => inside(event.at))
        .reduce((sum, event) => sum + event.count, 0),
    };
  });

  return {
    buckets,
    streams,
    donationsDuringStreamsMinor: streams.reduce((sum, stream) => sum + stream.donationsMinor, 0),
  };
}
