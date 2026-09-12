import { describe, expect, it } from 'vitest';
import { IDLE_INTERVAL_MS, isDue, LIVE_INTERVAL_MS } from './analytics-poller.service';

const NOW = new Date('2026-09-12T12:00:00.000Z').getTime();

function ago(ms: number): Date {
  return new Date(NOW - ms);
}

describe('каденция опроса каналов', () => {
  it('опрашивает канал, который ещё ни разу не собирали', () => {
    expect(isDue({ lastSyncedAt: null, syncState: 'OK', wasLive: false }, NOW)).toBe(true);
  });

  it('в эфире опрашивает раз в минуту', () => {
    expect(isDue({ lastSyncedAt: ago(59_000), syncState: 'OK', wasLive: true }, NOW)).toBe(false);
    expect(
      isDue({ lastSyncedAt: ago(LIVE_INTERVAL_MS), syncState: 'OK', wasLive: true }, NOW),
    ).toBe(true);
  });

  it('вне эфира опрашивает раз в пятнадцать минут', () => {
    // Это не про «медленно меняются подписчики», а про квоту: минутный опрос
    // круглые сутки стоил бы 4320 единиц YouTube на один канал при суточном
    // лимите 10 000 на весь проект.
    expect(
      isDue({ lastSyncedAt: ago(LIVE_INTERVAL_MS), syncState: 'OK', wasLive: false }, NOW),
    ).toBe(false);
    expect(
      isDue({ lastSyncedAt: ago(IDLE_INTERVAL_MS), syncState: 'OK', wasLive: false }, NOW),
    ).toBe(true);
  });

  it('не трогает канал с протухшим доступом', () => {
    // Повтор не поможет: пока пользователь не переподключит площадку, каждый
    // запрос стоит нам 401 и ничего больше.
    expect(
      isDue(
        { lastSyncedAt: ago(IDLE_INTERVAL_MS * 10), syncState: 'AUTH_EXPIRED', wasLive: true },
        NOW,
      ),
    ).toBe(false);
    expect(isDue({ lastSyncedAt: null, syncState: 'AUTH_EXPIRED', wasLive: false }, NOW)).toBe(
      false,
    );
  });

  it('возвращается к каналу, упёршемуся в квоту: лимит пройдёт сам', () => {
    expect(
      isDue(
        { lastSyncedAt: ago(IDLE_INTERVAL_MS), syncState: 'RATE_LIMITED', wasLive: false },
        NOW,
      ),
    ).toBe(true);
  });

  it('повторяет попытку после обычной ошибки', () => {
    expect(
      isDue({ lastSyncedAt: ago(IDLE_INTERVAL_MS), syncState: 'ERROR', wasLive: false }, NOW),
    ).toBe(true);
  });
});
