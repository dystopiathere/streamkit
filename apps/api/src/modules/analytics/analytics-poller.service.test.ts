import { describe, expect, it } from 'vitest';
import {
  IDLE_INTERVAL_MS,
  isDue,
  LIVE_INTERVAL_MS,
  retryDelayMs,
} from './analytics-poller.service';

const NOW = new Date('2026-09-12T12:00:00.000Z').getTime();

function ago(ms: number): Date {
  return new Date(NOW - ms);
}

describe('каденция опроса каналов', () => {
  it('опрашивает канал, который ещё ни разу не собирали', () => {
    expect(
      isDue({ lastSyncedAt: null, nextAttemptAt: null, syncState: 'OK', wasLive: false }, NOW),
    ).toBe(true);
  });

  it('в эфире опрашивает раз в минуту', () => {
    expect(
      isDue(
        { lastSyncedAt: ago(59_000), nextAttemptAt: null, syncState: 'OK', wasLive: true },
        NOW,
      ),
    ).toBe(false);
    expect(
      isDue(
        {
          lastSyncedAt: ago(LIVE_INTERVAL_MS),
          nextAttemptAt: null,
          syncState: 'OK',
          wasLive: true,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it('вне эфира опрашивает раз в пятнадцать минут', () => {
    // Это не про «медленно меняются подписчики», а про квоту: минутный опрос
    // круглые сутки стоил бы 4320 единиц YouTube на один канал при суточном
    // лимите 10 000 на весь проект.
    expect(
      isDue(
        {
          lastSyncedAt: ago(LIVE_INTERVAL_MS),
          nextAttemptAt: null,
          syncState: 'OK',
          wasLive: false,
        },
        NOW,
      ),
    ).toBe(false);
    expect(
      isDue(
        {
          lastSyncedAt: ago(IDLE_INTERVAL_MS),
          nextAttemptAt: null,
          syncState: 'OK',
          wasLive: false,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it('не трогает канал с протухшим доступом', () => {
    // Повтор не поможет: пока пользователь не переподключит площадку, каждый
    // запрос стоит нам 401 и ничего больше.
    expect(
      isDue(
        {
          lastSyncedAt: ago(IDLE_INTERVAL_MS * 10),
          nextAttemptAt: null,
          syncState: 'AUTH_EXPIRED',
          wasLive: true,
        },
        NOW,
      ),
    ).toBe(false);
    expect(
      isDue(
        { lastSyncedAt: null, nextAttemptAt: null, syncState: 'AUTH_EXPIRED', wasLive: false },
        NOW,
      ),
    ).toBe(false);
  });

  it('возвращается к каналу, упёршемуся в квоту: лимит пройдёт сам', () => {
    expect(
      isDue(
        {
          lastSyncedAt: ago(IDLE_INTERVAL_MS),
          nextAttemptAt: null,
          syncState: 'RATE_LIMITED',
          wasLive: false,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it('повторяет попытку после обычной ошибки', () => {
    expect(
      isDue(
        {
          lastSyncedAt: ago(IDLE_INTERVAL_MS),
          nextAttemptAt: null,
          syncState: 'ERROR',
          wasLive: false,
        },
        NOW,
      ),
    ).toBe(true);
  });
});

describe('пауза после неудачи', () => {
  it('растёт вдвое с каждой попыткой', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBe(240_000);
  });

  it('упирается в час и дальше не растёт', () => {
    // Без потолка десятая подряд неудача отложила бы канал на восемь часов —
    // площадка к тому моменту давно починилась бы.
    expect(retryDelayMs(10)).toBe(60 * 60_000);
    expect(retryDelayMs(100)).toBe(60 * 60_000);
  });

  it('держит канал на паузе, даже когда по каденции он давно готов', () => {
    // Ровно этого не хватало: lastSyncedAt при ошибке не двигается, поэтому
    // сбойный канал был «готов» каждую минуту и вытеснял исправные из выборки.
    expect(
      isDue(
        {
          lastSyncedAt: ago(IDLE_INTERVAL_MS * 10),
          nextAttemptAt: new Date(NOW + 60_000),
          syncState: 'ERROR',
          wasLive: false,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it('возвращает канал в опрос, когда пауза вышла', () => {
    expect(
      isDue(
        {
          lastSyncedAt: ago(IDLE_INTERVAL_MS),
          nextAttemptAt: new Date(NOW - 1),
          syncState: 'ERROR',
          wasLive: false,
        },
        NOW,
      ),
    ).toBe(true);
  });
});
