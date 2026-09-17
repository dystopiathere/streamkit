import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { IS_ADMIN_API_KEY, REQUIRED_ROLE_KEY } from '../../common/auth/auth.decorators';
import { AdminAuthController } from './admin-auth.controller';
import { AdminObjectsController, AdminUsersController } from './admin.controller';

/**
 * Права ручек админки — метаданные декораторов.
 *
 * Роль по умолчанию — `admin`: ручка, которую забыли пометить, закрыта от
 * поддержки. Таблица ниже фиксирует, что поддержке открыто сознательно, и
 * новая ручка без записи здесь роняет тест. Имена методов — строками: вывод
 * типа по классу с декораторами Nest съедал у tsc всю память.
 */
type ControllerClass = { prototype: object; name: string };

const EXPECTED: Array<[ControllerClass, Record<string, 'support' | 'admin'>]> = [
  [AdminAuthController, { login: 'support', refresh: 'support', logout: 'support', me: 'support' }],
  [
    AdminUsersController,
    {
      list: 'support',
      detail: 'support',
      revokeSessions: 'support',
      resetTotp: 'support',
      suspend: 'admin',
      restore: 'admin',
      setRole: 'admin',
      anonymize: 'admin',
      disableAutoRenew: 'admin',
      extend: 'admin',
    },
  ],
  [
    AdminObjectsController,
    {
      platformStats: 'support',
      widgets: 'support',
      setWidgetEnabled: 'support',
      tokens: 'support',
      revokeToken: 'support',
      revokeAllTokens: 'support',
      rooms: 'support',
      invites: 'support',
      revokeInvite: 'support',
      removeRoom: 'admin',
      channels: 'support',
      resync: 'support',
      payments: 'support',
      syncPayment: 'support',
      auditLog: 'admin',
    },
  ],
];

function handler(controller: ControllerClass, method: string): object {
  return (controller.prototype as Record<string, object>)[method]!;
}

function metadata<T>(key: string, controller: ControllerClass, method: string): T | undefined {
  return (
    (Reflect.getMetadata(key, handler(controller, method)) as T | undefined) ??
    (Reflect.getMetadata(key, controller) as T | undefined)
  );
}

describe('ручки админки', () => {
  for (const [controller, roles] of EXPECTED) {
    it(`${controller.name} принимает только админский токен`, () => {
      expect(Reflect.getMetadata(IS_ADMIN_API_KEY, controller)).toBe(true);
    });

    it(`${controller.name}: роль на каждой ручке совпадает с таблицей`, () => {
      const methods = Object.getOwnPropertyNames(controller.prototype).filter(
        (name) => name !== 'constructor',
      );
      expect(methods.sort()).toEqual(Object.keys(roles).sort());
      for (const [method, role] of Object.entries(roles)) {
        expect(metadata<string>(REQUIRED_ROLE_KEY, controller, method) ?? 'admin', method).toBe(
          role,
        );
      }
    });
  }

  it('жёсткий лимит — только на входе', () => {
    expect(metadata<boolean>('THROTTLER:SKIPauth', AdminAuthController, 'login')).toBe(false);
    for (const [controller, roles] of EXPECTED) {
      for (const method of Object.keys(roles)) {
        if (controller === AdminAuthController && method === 'login') continue;
        expect(metadata<boolean>('THROTTLER:SKIPauth', controller, method), method).toBe(true);
      }
    }
  });
});
