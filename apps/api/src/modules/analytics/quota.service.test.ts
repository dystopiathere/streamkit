import { describe, expect, it } from 'vitest';
import { nextQuotaReset, quotaKey } from './quota.service';

describe('ключ суточной квоты', () => {
  it('меняется в полночь по тихоокеанскому времени, а не по UTC', () => {
    // 06:59 и 07:01 UTC в сентябре — 23:59 и 00:01 по Калифорнии (PDT, UTC−7).
    const before = quotaKey('youtube', new Date('2026-09-13T06:59:00.000Z'));
    const after = quotaKey('youtube', new Date('2026-09-13T07:01:00.000Z'));
    expect(before).toContain('2026-09-12');
    expect(after).toContain('2026-09-13');

    // Полночь UTC — это пять вечера накануне: сутки Google ещё не кончились.
    expect(quotaKey('youtube', new Date('2026-09-13T00:30:00.000Z'))).toBe(before);
  });

  it('не смешивает площадки', () => {
    const day = new Date('2026-09-12T10:00:00.000Z');
    expect(quotaKey('youtube', day)).not.toBe(quotaKey('twitch', day));
  });
});

describe('обнуление квоты', () => {
  it('приходится на ближайшую полночь по тихоокеанскому времени', () => {
    expect(nextQuotaReset(new Date('2026-09-12T15:30:00.000Z')).toISOString()).toBe(
      '2026-09-13T07:00:00.000Z',
    );
  });

  it('в самой полуночи указывает на следующие сутки, а не на текущий момент', () => {
    // Иначе канал, упёршийся в квоту ровно в полночь, получил бы паузу нулевой
    // длины и тут же начал долбить площадку снова.
    expect(nextQuotaReset(new Date('2026-09-12T07:00:00.000Z')).toISOString()).toBe(
      '2026-09-13T07:00:00.000Z',
    );
  });

  it('учитывает перевод часов: сутки 1 ноября 2026 длятся 25 часов', () => {
    // 01:30 PDT, за полчаса до перевода; следующая полночь уже по PST (UTC−8).
    expect(nextQuotaReset(new Date('2026-11-01T08:30:00.000Z')).toISOString()).toBe(
      '2026-11-02T08:00:00.000Z',
    );
    // Весной сутки короче: 14 марта 2027 началось по PST, кончится по PDT.
    expect(nextQuotaReset(new Date('2027-03-14T08:30:00.000Z')).toISOString()).toBe(
      '2027-03-15T07:00:00.000Z',
    );
  });
});
