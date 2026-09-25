import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.service';
import type { HttpClient } from '../../common/http/http-client.service';
import {
  KICK_SCOPES,
  KickProvider,
  normalizeIdentity,
  normalizeKickTokens,
  normalizeStats,
} from './kick.provider';

/**
 * Полезные данные — по примерам из документации Kick (`docs.kick.com`) и
 * описанию ответов публичного API. На живом канале не сверены: приложение Kick
 * ещё не зарегистрировано.
 */
const USER = {
  user_id: 123456789,
  name: 'StreamerName',
  profile_picture: 'https://files.kick.com/images/user/123456789/profile_image.webp',
};

const CHANNEL = {
  broadcaster_user_id: 123456789,
  slug: 'streamer-name',
  stream_title: 'Ранговые',
  category: { id: 1, name: 'Just Chatting', thumbnail: '' },
  stream: {
    is_live: true,
    viewer_count: 1543,
    start_time: '2026-09-12T08:30:00Z',
  },
  active_subscribers_count: 87,
};

describe('нормализация профиля Kick', () => {
  it('берёт id и имя у пользователя, адрес — у канала', () => {
    expect(normalizeIdentity(USER, CHANNEL)).toEqual({
      externalId: '123456789',
      login: 'streamer-name',
      displayName: 'StreamerName',
      avatarUrl: USER.profile_picture,
    });
  });

  it('пустая картинка профиля — null, а не пустая строка', () => {
    expect(normalizeIdentity({ ...USER, profile_picture: '' }, CHANNEL).avatarUrl).toBeNull();
  });
});

describe('нормализация метрик Kick', () => {
  const capturedAt = new Date('2026-09-12T10:00:00.000Z');

  it('собирает снимок идущего эфира без выдуманных фолловеров', () => {
    expect(normalizeStats(CHANNEL, capturedAt)).toEqual({
      capturedAt: '2026-09-12T10:00:00.000Z',
      isLive: true,
      viewers: 1543,
      followers: null,
      subscribers: 87,
      totalViews: null,
      title: 'Ранговые',
      category: 'Just Chatting',
      liveSince: '2026-09-12T08:30:00.000Z',
    });
  });

  it('вне эфира зрителей и начала эфира нет, а не ноль', () => {
    const stats = normalizeStats(
      {
        ...CHANNEL,
        // Даже осмысленное на вид время вне эфира в снимок не идёт.
        stream: { is_live: false, viewer_count: 0, start_time: '0001-01-01T00:00:00Z' },
      },
      capturedAt,
    );
    expect(stats.isLive).toBe(false);
    expect(stats.viewers).toBeNull();
    expect(stats.liveSince).toBeNull();
  });

  it('канал без блока эфира — не в эфире', () => {
    expect(normalizeStats({ ...CHANNEL, stream: null }, capturedAt).isLive).toBe(false);
  });

  it('подписчиков чужого канала площадка не отдаёт — null', () => {
    const { active_subscribers_count: _omit, ...foreign } = CHANNEL;
    expect(normalizeStats(foreign, capturedAt).subscribers).toBeNull();
  });
});

describe('токены Kick', () => {
  it('срок строкой всё равно даёт срок: иначе токен ни разу не продлился бы', () => {
    const before = Date.now();
    const tokens = normalizeKickTokens({
      access_token: 'a',
      refresh_token: 'r',
      expires_in: '7200',
      scope: 'user:read channel:read events:subscribe',
    });
    expect(tokens.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 7_200_000);
    expect(tokens.scopes).toEqual(KICK_SCOPES);
  });

  it('пустой срок — без срока, а не «истёк в 1970-м»', () => {
    expect(normalizeKickTokens({ access_token: 'a', expires_in: '' }).expiresAt).toBeNull();
  });
});

describe('ссылка входа в Kick', () => {
  const config = {
    kickEndpoints: { auth: 'https://id.kick.com', api: 'https://api.kick.com' },
    oauthRedirectBaseUrl: 'https://api.stream-kit.ru/',
    oauthCredentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
  } as unknown as AppConfig;
  const provider = new KickProvider({} as HttpClient, config);

  it('несёт PKCE, права и адрес возврата', () => {
    const url = new URL(provider.buildAuthorizeUrl('state-1', 'challenge-1'));
    expect(url.origin + url.pathname).toBe('https://id.kick.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client',
      redirect_uri: 'https://api.stream-kit.ru/api/integrations/kick/callback',
      response_type: 'code',
      scope: 'user:read channel:read events:subscribe',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
    });
  });

  it('без code_challenge ссылку не выпускает: Kick всё равно откажет', () => {
    expect(() => provider.buildAuthorizeUrl('state-1')).toThrow();
  });
});
