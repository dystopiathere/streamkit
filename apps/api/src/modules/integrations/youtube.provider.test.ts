import { describe, expect, it } from 'vitest';
import type { HttpClient } from '../../common/http/http-client.service';
import type { AppConfig } from '../../config/app-config.service';
import { normalizeIdentity, normalizeStats, YouTubeProvider } from './youtube.provider';

/** Записано с настоящего ответа `channels.list?part=snippet,statistics&mine=true`. */
const CHANNEL = {
  id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
  snippet: {
    title: 'Google for Developers',
    customUrl: '@googledevelopers',
    thumbnails: {
      default: { url: 'https://yt3.ggpht.com/small.jpg' },
      medium: { url: 'https://yt3.ggpht.com/medium.jpg' },
    },
  },
  statistics: { subscriberCount: '2410000', viewCount: '271398936' },
};

const capturedAt = new Date('2026-09-12T10:00:00.000Z');

describe('нормализация канала YouTube', () => {
  it('переносит идентификатор, адрес и аватар', () => {
    expect(normalizeIdentity(CHANNEL)).toEqual({
      externalId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
      login: '@googledevelopers',
      displayName: 'Google for Developers',
      avatarUrl: 'https://yt3.ggpht.com/medium.jpg',
    });
  });

  it('берёт идентификатор вместо адреса, пока канал его не выбрал', () => {
    const identity = normalizeIdentity({
      ...CHANNEL,
      snippet: { ...CHANNEL.snippet, customUrl: undefined },
    });
    expect(identity.login).toBe('UC_x5XG1OV2P6uZZ5FSM9Ttw');
  });

  it('откатывается на мелкий аватар, когда среднего нет', () => {
    const identity = normalizeIdentity({
      ...CHANNEL,
      snippet: { ...CHANNEL.snippet, thumbnails: { default: { url: 'https://a/small.jpg' } } },
    });
    expect(identity.avatarUrl).toBe('https://a/small.jpg');
  });
});

describe('нормализация метрик YouTube', () => {
  it('собирает снимок идущего эфира', () => {
    const stats = normalizeStats({
      channel: CHANNEL,
      broadcast: { id: 'abc123', snippet: { title: 'Прямой эфир' } },
      video: { liveStreamingDetails: { concurrentViewers: '842' } },
      capturedAt,
    });

    expect(stats).toEqual({
      capturedAt: '2026-09-12T10:00:00.000Z',
      isLive: true,
      viewers: 842,
      followers: null,
      subscribers: 2_410_000,
      totalViews: 271_398_936,
      title: 'Прямой эфир',
      category: null,
    });
  });

  it('вне эфира зрители — null, а метрики канала остаются', () => {
    const stats = normalizeStats({
      channel: CHANNEL,
      broadcast: undefined,
      video: undefined,
      capturedAt,
    });

    expect(stats.isLive).toBe(false);
    expect(stats.viewers).toBeNull();
    expect(stats.subscribers).toBe(2_410_000);
    expect(stats.totalViews).toBe(271_398_936);
  });

  it('скрытый счётчик подписчиков остаётся null, а не нулём', () => {
    // YouTube при скрытом счётчике присылает subscriberCount: '0' вместе с
    // hiddenSubscriberCount: true. Записать этот ноль — значит нарисовать
    // канал без подписчиков.
    const stats = normalizeStats({
      channel: {
        ...CHANNEL,
        statistics: { subscriberCount: '0', viewCount: '100', hiddenSubscriberCount: true },
      },
      broadcast: undefined,
      video: undefined,
      capturedAt,
    });

    expect(stats.subscribers).toBeNull();
    expect(stats.totalViews).toBe(100);
  });

  it('фолловеров у YouTube нет как понятия', () => {
    const stats = normalizeStats({
      channel: CHANNEL,
      broadcast: undefined,
      video: undefined,
      capturedAt,
    });
    expect(stats.followers).toBeNull();
  });

  it('переживает эфир, у которого ещё нет числа зрителей', () => {
    // Между началом трансляции и появлением concurrentViewers проходит время.
    const stats = normalizeStats({
      channel: CHANNEL,
      broadcast: { id: 'abc123', snippet: { title: 'Начинаем' } },
      video: { liveStreamingDetails: {} },
      capturedAt,
    });

    expect(stats.isLive).toBe(true);
    expect(stats.viewers).toBeNull();
    expect(stats.title).toBe('Начинаем');
  });

  it('не падает, когда канал не пришёл вовсе', () => {
    const stats = normalizeStats({
      channel: undefined,
      broadcast: undefined,
      video: undefined,
      capturedAt,
    });

    expect(stats.subscribers).toBeNull();
    expect(stats.totalViews).toBeNull();
  });
});

describe('разрешения Google', () => {
  it('просит у Google только youtube.readonly', () => {
    // Политика конфиденциальности (раздел 5) обещает ровно одно разрешение и
    // ни почты, ни профиля аккаунта Google. Лишний scope — это новая редакция
    // политики и новая проверка приложения в Google, а не строчка в коде.
    const config = {
      oauthCredentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
      oauthRedirectBaseUrl: 'https://api.example.test',
    } as unknown as AppConfig;
    const provider = new YouTubeProvider({} as HttpClient, config);

    const url = new URL(provider.buildAuthorizeUrl('state'));

    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly');
  });
});
