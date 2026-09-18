import { loginSchema } from '@streamkit/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import i18n from 'i18next';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { localizedResolver } from '@/lib/form-errors';
import { formatMoney, intlLocale } from '@/lib/locale';

/**
 * Английский дашборд: тексты, которые приходят не из словаря интерфейса, —
 * ошибки API, проверки схем форм, суммы — тоже на английском.
 */
describe('английский интерфейс', () => {
  beforeAll(async () => {
    await i18n.init({ lng: 'en', resources: {} });
  });

  afterAll(async () => {
    await i18n.changeLanguage('ru');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ошибку API показывает по-английски, детали проверки тоже', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          message: 'Ошибка валидации',
          errors: [{ path: 'password', message: 'Минимум 12 символов' }],
        }),
      })),
    );

    const error = await api.post('/auth/register', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Some fields are filled in incorrectly');
    expect((error as ApiError).details).toEqual([
      { path: 'password', message: 'At least 12 characters' },
    ]);
  });

  it('ошибку поля формы показывает по-английски', async () => {
    const resolver = localizedResolver(zodResolver(loginSchema));

    const result = await resolver(
      { email: 'streamer@example.com', password: 'пароль', totpCode: '12' },
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );

    expect(result.errors.totpCode?.message).toBe('A 6-digit code');
  });

  it('суммы и даты — в английском формате', () => {
    expect(intlLocale()).toBe('en-US');
    expect(formatMoney({ amountMinor: 49_000, currency: 'RUB' })).toBe('₽490');
  });
});
