import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AuthController } from './auth.controller';

/**
 * Жёсткий лимитер `auth` — только там, где перебирают секрет.
 *
 * Интеграционные тесты этого не видят: лимиты в них подняты. Поэтому проверяются
 * метаданные декораторов, как у вебхуков LiveKit и ЮKassa.
 */
describe('лимиты AuthController', () => {
  // Имена методов строками, а не `keyof AuthController`: вывод типа по классу с
  // декораторами Nest съедал у tsc всю память.
  const skipsAuthLimiter = (method: string): boolean => {
    const handler = (AuthController.prototype as unknown as Record<string, object>)[method]!;
    const own = Reflect.getMetadata('THROTTLER:SKIPauth', handler) as boolean | undefined;
    return own ?? (Reflect.getMetadata('THROTTLER:SKIPauth', AuthController) as boolean);
  };

  it('держит жёсткий лимит на входе, регистрации, пароле и втором факторе', () => {
    for (const method of [
      'login',
      'register',
      'changePassword',
      'forgotPassword',
      'resetPassword',
      'confirmTotp',
      'disableTotp',
    ]) {
      expect(skipsAuthLimiter(method), method).toBe(false);
    }
  });

  it('не держит его на обновлении токена и чтении сессии: за общим IP это разлогинивало людей', () => {
    for (const method of ['refresh', 'logout', 'me', 'sessions', 'revokeSession']) {
      expect(skipsAuthLimiter(method), method).toBe(true);
    }
  });
});
