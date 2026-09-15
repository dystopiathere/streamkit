import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeCookieChoice } from '@/lib/cookie-consent';
import {
  isTrackedPath,
  loadSiteStats,
  resetSiteStatsForTests,
  sanitizeSiteStatsPayload,
  setSiteStatsDisabled,
  trackSiteEvent,
} from './site-stats';

describe('статистика посещений', () => {
  afterEach(() => {
    document.head.querySelectorAll('script').forEach((script) => script.remove());
    resetSiteStatsForTests();
    window.localStorage.clear();
    delete window.umami;
  });

  it('считает только публичные страницы: ни дашборда, ни страницы гостя', () => {
    for (const path of ['/', '/login', '/register', '/legal/terms']) {
      expect(isTrackedPath(path), path).toBe(true);
    }
    for (const path of ['/widgets', '/billing', '/rooms/1', '/join', '/privacy', '/legalize']) {
      expect(isTrackedPath(path), path).toBe(false);
    }
  });

  it('грузит счётчик со своего домена, без автоучёта и фрагмента, с фильтром адресов', () => {
    void loadSiteStats('6a0d6d57-8b3d-4a53-9d2b-0a6f2b1f7c11').catch(() => undefined);
    void loadSiteStats('6a0d6d57-8b3d-4a53-9d2b-0a6f2b1f7c11').catch(() => undefined);

    const scripts = document.head.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    const script = scripts[0]!;
    expect(script.getAttribute('src')).toBe('/u/script.js');
    expect(script.dataset).toMatchObject({
      websiteId: '6a0d6d57-8b3d-4a53-9d2b-0a6f2b1f7c11',
      hostUrl: `${window.location.origin}/u`,
      autoTrack: 'false',
      excludeHash: 'true',
      beforeSend: 'streamkitSiteStatsBeforeSend',
    });
    expect(typeof window.streamkitSiteStatsBeforeSend).toBe('function');
  });

  it('из адресов уходят путь и метки utm, но не остальная строка запроса', () => {
    const payload = sanitizeSiteStatsPayload({
      website: 'w',
      url: `${window.location.origin}/register?utm_source=vk&utm_campaign=launch&code=secret&token=abc`,
      referrer: 'https://yandex.ru/search/?text=streamkit+мой+ник',
    });
    expect(payload).toEqual({
      website: 'w',
      url: '/register?utm_source=vk&utm_campaign=launch',
      referrer: 'https://yandex.ru/search/',
    });
    expect(sanitizeSiteStatsPayload({ url: '/legal/terms?x=1' }).url).toBe('/legal/terms');
  });

  it('шаг воронки уходит только при согласии', () => {
    const track = vi.fn();
    window.umami = { track };

    trackSiteEvent('signup');
    writeCookieChoice('necessary');
    trackSiteEvent('signup');
    expect(track).not.toHaveBeenCalled();

    writeCookieChoice('all');
    trackSiteEvent('signup');
    expect(track).toHaveBeenCalledWith('signup');
  });

  it('выключатель Umami ставится при отказе и снимается при согласии', () => {
    setSiteStatsDisabled(true);
    expect(window.localStorage.getItem('umami.disabled')).toBe('1');
    setSiteStatsDisabled(false);
    expect(window.localStorage.getItem('umami.disabled')).toBeNull();
  });
});
