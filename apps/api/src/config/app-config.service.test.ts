import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { AppConfig } from './app-config.service';

/** Конфигурация так, как её видит приложение: без ключа, а не с пустым значением. */
function configWith(values: Record<string, unknown>): AppConfig {
  return new AppConfig(new ConfigService(values) as never);
}

/**
 * Необязательные переменные читаются без исключения.
 *
 * Внутренний `value()` идёт через `getOrThrow`, и необязательный ключ, прочитанный
 * им, роняет приложение ровно там, где отсутствие ключа — штатная ситуация.
 * `TWITCH_IRC_URL` так и прожил до проверки на живом Twitch: интеграционные
 * тесты задают его всегда, а в боевом окружении он пуст всегда — чат падал на
 * первом же такте воркера.
 */
describe('необязательные переменные окружения', () => {
  it('адрес IRC-шлюза Twitch необязателен', () => {
    expect(() => configWith({}).twitchIrcUrl).not.toThrow();
    expect(configWith({}).twitchIrcUrl).toBeUndefined();
  });

  it('заданный адрес отдаётся как есть', () => {
    expect(configWith({ TWITCH_IRC_URL: 'ws://127.0.0.1:1234' }).twitchIrcUrl).toBe(
      'ws://127.0.0.1:1234',
    );
  });

  it('домен cookie необязателен', () => {
    expect(() => configWith({}).cookieDomain).not.toThrow();
  });

  it('ненастроенная площадка — это null, а не исключение', () => {
    expect(configWith({}).oauthCredentials('twitch')).toBeNull();
  });
});
