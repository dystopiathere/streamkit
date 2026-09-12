import { describe, expect, it } from 'vitest';
import { normalizeIdentity, normalizeStats } from './twitch.provider';

/**
 * Полезные данные записаны с настоящих ответов Helix.
 *
 * Проверяется именно нормализация: сетевой слой и OAuth здесь ни при чём, а
 * ломается обычно перевод «что прислала площадка» в «что мы храним» — особенно
 * на полях, которых в ответе нет.
 */
const USER = {
  id: '141981764',
  login: 'twitchdev',
  display_name: 'TwitchDev',
  profile_image_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc.png',
};

describe('нормализация профиля Twitch', () => {
  it('переносит идентификатор, логин и аватар', () => {
    expect(normalizeIdentity(USER)).toEqual({
      externalId: '141981764',
      login: 'twitchdev',
      displayName: 'TwitchDev',
      avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc.png',
    });
  });

  it('подставляет логин, когда отображаемое имя пустое', () => {
    expect(normalizeIdentity({ ...USER, display_name: '' }).displayName).toBe('twitchdev');
  });

  it('не выдумывает аватар, если площадка его не прислала', () => {
    expect(normalizeIdentity({ ...USER, profile_image_url: undefined }).avatarUrl).toBeNull();
  });
});

describe('нормализация метрик Twitch', () => {
  const capturedAt = new Date('2026-09-12T10:00:00.000Z');

  it('собирает снимок идущего эфира', () => {
    const stats = normalizeStats({
      stream: { viewer_count: 1543, title: 'Ранговые', game_name: 'Dota 2' },
      followersTotal: 89_120,
      subscribersTotal: 412,
      capturedAt,
    });

    expect(stats).toEqual({
      capturedAt: '2026-09-12T10:00:00.000Z',
      isLive: true,
      viewers: 1543,
      followers: 89_120,
      subscribers: 412,
      totalViews: null,
      title: 'Ранговые',
      category: 'Dota 2',
    });
  });

  it('вне эфира зрители — null, а не ноль', () => {
    // Ноль означал бы «шёл стрим, и никто не смотрел». Это другое утверждение,
    // и на графике оно рисуется как обвал до нуля.
    const stats = normalizeStats({
      stream: undefined,
      followersTotal: 89_120,
      subscribersTotal: 412,
      capturedAt,
    });

    expect(stats.isLive).toBe(false);
    expect(stats.viewers).toBeNull();
    expect(stats.followers).toBe(89_120);
  });

  it('принимает счётчики, пришедшие строками', () => {
    const stats = normalizeStats({
      stream: undefined,
      followersTotal: '89120',
      subscribersTotal: '412',
      capturedAt,
    });

    expect(stats.followers).toBe(89_120);
    expect(stats.subscribers).toBe(412);
  });

  it('оставляет null там, где площадка не дала числа', () => {
    // Права `channel:read:subscriptions` может не быть — тогда total отсутствует.
    const stats = normalizeStats({
      stream: undefined,
      followersTotal: 10,
      subscribersTotal: undefined,
      capturedAt,
    });

    expect(stats.subscribers).toBeNull();
  });

  it('не отдаёт суммарные просмотры: Twitch убрал этот счётчик', () => {
    const stats = normalizeStats({
      stream: { viewer_count: 5 },
      followersTotal: 1,
      subscribersTotal: 1,
      capturedAt,
    });

    expect(stats.totalViews).toBeNull();
  });

  it('не превращает мусор в число', () => {
    const stats = normalizeStats({
      stream: undefined,
      followersTotal: 'много',
      subscribersTotal: -5,
      capturedAt,
    });

    expect(stats.followers).toBeNull();
    expect(stats.subscribers).toBeNull();
  });
});
