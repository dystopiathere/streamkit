import { describe, expect, it } from 'vitest';
import { newDeviceMessage, passwordChangedMessage, totpDisabledMessage } from './security-mail';

const base = {
  email: 'streamer@example.com',
  displayName: 'Стример',
  language: 'ru' as const,
  // 21:30 UTC — уже 00:30 следующих суток по Москве.
  at: new Date('2026-10-15T21:30:00Z'),
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  webBaseUrl: 'https://stream-kit.ru/',
};

describe('письма о безопасности', () => {
  it('вход с нового устройства: устройство, время по Москве и куда идти', () => {
    const message = newDeviceMessage(base);
    expect(message.to).toBe('streamer@example.com');
    expect(message.subject).toBe('StreamKit: вход с нового устройства');
    expect(message.text).toContain('Safari, iOS');
    expect(message.text).toContain('16 октября 2026, 00:30 по Москве');
    expect(message.text).toContain('https://stream-kit.ru/account/security');
  });

  it('неузнанный браузер называется словами', () => {
    const message = newDeviceMessage({ ...base, userAgent: null, language: 'en' });
    expect(message.text).toContain('Unknown browser');
    expect(message.text).toContain('16 October 2026, 00:30 Moscow time');
    expect(message.text).toContain('https://stream-kit.ru/account/security?lang=en');
  });

  it('смена пароля ведёт на восстановление: старый пароль у владельца уже не работает', () => {
    const settings = passwordChangedMessage({ ...base, via: 'settings' });
    expect(settings.text).toContain('Остальные устройства вышли');
    expect(settings.text).toContain('https://stream-kit.ru/forgot-password');

    const reset = passwordChangedMessage({ ...base, via: 'reset' });
    expect(reset.text).toContain('Все устройства вышли');
  });

  it('выключение второго фактора', () => {
    const ru = totpDisabledMessage(base);
    expect(ru.subject).toBe('StreamKit: двухфакторный вход выключен');
    const en = totpDisabledMessage({ ...base, language: 'en' });
    expect(en.subject).toBe('StreamKit: two-factor sign-in turned off');
    expect(en.html).toContain('lang="en"');
  });

  it('имя из регистрации не становится разметкой', () => {
    const message = newDeviceMessage({ ...base, displayName: '<img src=x onerror=alert(1)>' });
    expect(message.html).not.toContain('<img');
    expect(message.text).toContain('<img src=x onerror=alert(1)>');
  });
});
