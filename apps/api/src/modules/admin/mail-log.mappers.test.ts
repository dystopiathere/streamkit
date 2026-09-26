import { MailKind, MailStatus } from '@prisma/client';
import { MAIL_KINDS, MAIL_STATUSES } from '@streamkit/contracts';
import { describe, expect, it } from 'vitest';
import { toContractMailKind, toContractMailStatus } from './admin.mappers';

/**
 * Виды писем переводятся сменой регистра, без таблицы. Новый вид в схеме
 * Prisma, забытый в contracts, ломал бы ответ карточки схемой — ловим здесь.
 */
describe('журнал писем в админке', () => {
  it('каждый вид и исход письма из БД есть в contracts', () => {
    expect(Object.values(MailKind).map(toContractMailKind).sort()).toEqual([...MAIL_KINDS].sort());
    expect(Object.values(MailStatus).map(toContractMailStatus).sort()).toEqual(
      [...MAIL_STATUSES].sort(),
    );
  });
});
