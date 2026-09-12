import { describe, expect, it } from 'vitest';
import { quotaKey } from './quota.service';

describe('ключ суточной квоты', () => {
  it('меняется вместе с датой', () => {
    const first = quotaKey('youtube', new Date('2026-09-12T23:59:59.000Z'));
    const second = quotaKey('youtube', new Date('2026-09-13T00:00:01.000Z'));
    expect(first).not.toBe(second);
  });

  it('не смешивает площадки', () => {
    const day = new Date('2026-09-12T10:00:00.000Z');
    expect(quotaKey('youtube', day)).not.toBe(quotaKey('twitch', day));
  });

  it('считает сутки по UTC, а не по зоне сервера', () => {
    // Зона сервера может быть какой угодно, а квота Google сбрасывается по
    // фиксированному расписанию. Привязка к местному времени дала бы разный
    // ключ на разных инстансах — то есть два счётчика вместо одного.
    expect(quotaKey('youtube', new Date('2026-09-12T22:00:00.000Z'))).toContain('2026-09-12');
  });
});
