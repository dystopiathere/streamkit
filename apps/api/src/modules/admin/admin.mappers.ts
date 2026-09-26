import type {
  MailKind as PrismaMailKind,
  MailStatus as PrismaMailStatus,
  Prisma,
  UserRole as PrismaUserRole,
  UserStatus as PrismaUserStatus,
} from '@prisma/client';
import type { MailKind, MailStatus, StaffRole, UserRole, UserStatus } from '@streamkit/contracts';
import type { Request } from 'express';
import type { AuditContext, AuditService } from '../../common/audit/audit.service';
import type { StaffUser } from '../../common/auth/auth.decorators';

export function toContractRole(role: PrismaUserRole): UserRole {
  return role === 'ADMIN' ? 'admin' : role === 'SUPPORT' ? 'support' : 'user';
}

export function toPrismaRole(role: UserRole): PrismaUserRole {
  return role === 'admin' ? 'ADMIN' : role === 'support' ? 'SUPPORT' : 'USER';
}

export function toStaffRole(role: PrismaUserRole): StaffRole | null {
  return role === 'ADMIN' ? 'admin' : role === 'SUPPORT' ? 'support' : null;
}

export function toContractStatus(status: PrismaUserStatus): UserStatus {
  return status === 'SUSPENDED' ? 'suspended' : status === 'ANONYMIZED' ? 'anonymized' : 'active';
}

export function toPrismaStatus(status: UserStatus): PrismaUserStatus {
  return status === 'suspended' ? 'SUSPENDED' : status === 'anonymized' ? 'ANONYMIZED' : 'ACTIVE';
}

/** `PASSWORD_RESET` → `password_reset`: названия видов совпадают, меняется регистр. */
export function toContractMailKind(kind: PrismaMailKind): MailKind {
  return kind.toLowerCase() as MailKind;
}

export function toContractMailStatus(status: PrismaMailStatus): MailStatus {
  return status.toLowerCase() as MailStatus;
}

/** Контекст аудита для действия сотрудника: автор — он, адрес — его. */
export function staffContext(
  audit: AuditService,
  request: Request,
  staff: StaffUser,
  metadata?: Record<string, unknown>,
): AuditContext {
  return {
    ...audit.contextFromRequest(request),
    actorId: staff.id,
    ...(metadata ? { metadata } : {}),
  };
}

/**
 * Поиск подстрокой без сюрпризов.
 *
 * `%` и `_` в запросе — обычные символы, а не шаблон: иначе «_» находил бы
 * каждого пользователя, а подбор шаблонов превращался бы в перебор адресов.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Курсорная страница: самые новые сначала, при равном времени — по id.
 *
 * Без второго ключа записи, созданные в одну миллисекунду (пачка в тестах,
 * импорт), делили бы место в порядке, который база не обещает сохранять.
 */
export function pageArgs(limit: number, cursor: string | undefined) {
  return {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Array<
      Partial<Record<'createdAt' | 'id', Prisma.SortOrder>>
    >,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { rows: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}
