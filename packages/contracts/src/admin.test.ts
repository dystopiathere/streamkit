import { describe, expect, it } from 'vitest';
import {
  adminAuditQuerySchema,
  adminChannelSchema,
  adminLoginSchema,
  adminStatsBucket,
  adminUserListQuerySchema,
  roleAllows,
} from './admin.js';

describe('контракты админки', () => {
  it('админ может всё, что поддержка, но не наоборот; стример — ничего', () => {
    expect(roleAllows('admin', 'support')).toBe(true);
    expect(roleAllows('admin', 'admin')).toBe(true);
    expect(roleAllows('support', 'support')).toBe(true);
    expect(roleAllows('support', 'admin')).toBe(false);
    expect(roleAllows('user', 'support')).toBe(false);
  });

  it('вход в админку без кода не принимается схемой', () => {
    expect(adminLoginSchema.safeParse({ email: 'a@b.ru', password: 'x' }).success).toBe(false);
    expect(
      adminLoginSchema.safeParse({ email: 'A@B.ru', password: 'x', totpCode: '123456' }).data
        ?.email,
    ).toBe('a@b.ru');
  });

  it('фильтры списка пользователей приходят строкой запроса', () => {
    expect(adminUserListQuerySchema.parse({ limit: '5' })).toMatchObject({
      limit: 5,
      subscription: 'any',
    });
    expect(adminUserListQuerySchema.safeParse({ role: 'owner' }).success).toBe(false);
  });

  it('префикс действия в журнале — только из безопасных символов', () => {
    expect(adminAuditQuerySchema.safeParse({ action: 'admin.' }).success).toBe(true);
    expect(adminAuditQuerySchema.safeParse({ action: "admin%' OR 1=1" }).success).toBe(false);
  });

  it('год разбит на недели, месяц и квартал — на дни', () => {
    expect(adminStatsBucket('30d')).toBe('day');
    expect(adminStatsBucket('90d')).toBe('day');
    expect(adminStatsBucket('365d')).toBe('week');
  });
});

describe('канал в админке', () => {
  it('без показателей и названий эфиров — только адрес, название и состояние сбора', () => {
    // Политика (раздел 5.3) обещает: данные из Google сотрудник видит только
    // такие. Новое поле здесь — сначала вопрос к политике, потом к схеме.
    expect(Object.keys(adminChannelSchema.shape).sort()).toEqual(
      [
        'displayName',
        'id',
        'isEnabled',
        'lastSyncedAt',
        'login',
        'nextAttemptAt',
        'ownerEmail',
        'platform',
        'syncAttempts',
        'syncError',
        'syncState',
        'userId',
      ].sort(),
    );
  });
});
