import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UserRole } from '@streamkit/contracts';
import type { Redis } from 'ioredis';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { blockedUserKey } from '../../common/auth/access-token';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { AppConfig } from '../../config/app-config.service';
import { ADMIN_ACCESS_TTL_SECONDS, TokenService } from '../auth/token.service';
import { PrivacyService } from '../privacy/privacy.service';
import { RoomEviction } from '../rooms/room-eviction.service';
import { WidgetsService } from '../widgets/widgets.service';
import { toContractRole, toPrismaRole } from './admin.mappers';

/**
 * Доступ к аккаунту: блокировка, роли, второй фактор, сессии, обезличивание.
 *
 * Всё, что меняет, КТО может войти и что продолжает работать от имени
 * аккаунта, собрано здесь: у блокировки пять следствий, и забытое одно
 * оставляет заблокированному работающую сцену в OBS или созвон с гостями.
 */
@Injectable()
export class AccountStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly widgets: WidgetsService,
    private readonly rooms: RoomEviction,
    private readonly bus: RealtimeBus,
    private readonly privacy: PrivacyService,
    private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Блокировка.
   *
   * Повторный вызов для уже заблокированного не пропускается: он доделывает
   * шаги, которые могли не пройти в первый раз (Redis, медиасервер).
   */
  async suspend(userId: string, reason: string, context: AuditContext): Promise<void> {
    const user = await this.requireUser(userId);
    if (userId === context.actorId) {
      throw new BadRequestException('Нельзя заблокировать собственный аккаунт');
    }
    if (user.status === 'ANONYMIZED') {
      throw new ConflictException('Аккаунт обезличен');
    }

    const wasActive = user.status === 'ACTIVE';
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.markBlocked(userId);

    if (wasActive) {
      await this.audit.record('admin.user.suspended', userId, {
        ...context,
        metadata: { reason },
      });
    }

    await this.bus.publish({ kind: 'user-suspended', userId });
    await this.widgets.disconnectOverlays(
      userId,
      await this.widgets.activeOverlayTokenIds(userId),
      'owner-suspended',
    );
    const rooms = await this.prisma.room.findMany({ where: { userId }, select: { id: true } });
    await this.rooms.emptyRooms(rooms.map((room) => room.id));
  }

  /** Разблокировка. Сессии не возвращаются: пользователь входит заново. */
  async restore(userId: string, context: AuditContext): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.status !== 'SUSPENDED') {
      throw new ConflictException('Аккаунт не заблокирован');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    await this.redis.del(blockedUserKey(userId));
    await this.audit.record('admin.user.restored', userId, context);
  }

  async setRole(userId: string, role: UserRole, context: AuditContext): Promise<void> {
    const user = await this.requireUser(userId);
    if (userId === context.actorId) {
      // Иначе единственный админ мог бы снять роль с себя и оставить платформу
      // без админки — вернуть её можно было бы только скриптом на сервере.
      throw new BadRequestException('Свою роль менять нельзя');
    }
    if (user.status === 'ANONYMIZED') {
      throw new ConflictException('Аккаунт обезличен');
    }
    const next = toPrismaRole(role);
    if (next === user.role) return;

    await this.prisma.user.update({ where: { id: userId }, data: { role: next } });
    if (next === 'USER') {
      await this.prisma.refreshToken.updateMany({
        where: { userId, scope: 'ADMIN', revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record('admin.role.changed', userId, {
      ...context,
      metadata: { from: toContractRole(user.role), to: role },
    });
  }

  /** Сброс второго фактора — потерянный телефон. Сессии гасятся: доступ мог уйти вместе с ним. */
  async resetTotp(userId: string, context: AuditContext): Promise<void> {
    const user = await this.requireUser(userId);
    if (!user.isTotpEnabled && !user.totpSecretEncrypted) {
      throw new ConflictException('Двухфакторная аутентификация не включена');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { isTotpEnabled: false, totpSecretEncrypted: null },
    });
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record('admin.totp.reset', userId, context);
  }

  async revokeSessions(
    userId: string,
    familyId: string | undefined,
    context: AuditContext,
  ): Promise<void> {
    await this.requireUser(userId);
    if (familyId) {
      const found = await this.prisma.refreshToken.findFirst({
        where: { userId, familyId, revokedAt: null },
        select: { id: true },
      });
      if (!found) throw new NotFoundException('Сессия не найдена');
      await this.tokens.revokeFamily(familyId);
    } else {
      await this.tokens.revokeAllForUser(userId);
    }
    await this.audit.record('admin.sessions.revoked', userId, {
      ...context,
      metadata: { familyId: familyId ?? 'all' },
    });
  }

  /**
   * Обезличивание по решению платформы: например, по запросу человека, который
   * больше не может войти в свой аккаунт. Почта сверяется до действия —
   * необратимое не выполняется по одному идентификатору из адресной строки.
   */
  async anonymize(userId: string, confirmEmail: string, context: AuditContext): Promise<void> {
    const user = await this.requireUser(userId);
    if (userId === context.actorId) {
      throw new BadRequestException('Свой аккаунт обезличивается в дашборде');
    }
    if (user.status === 'ANONYMIZED') {
      throw new ConflictException('Аккаунт уже обезличен');
    }
    if (user.email !== confirmEmail) {
      throw new BadRequestException('Почта не совпадает с почтой аккаунта');
    }
    await this.privacy.anonymize(userId, context);
    await this.markBlocked(userId);
    // Роль обезличенному не нужна: сотрудник, ушедший так, не должен сохранить
    // вход по восстановленному аккаунту.
    await this.prisma.user.update({ where: { id: userId }, data: { role: 'USER' } });
    await this.audit.record('admin.user.anonymized', userId, context);
  }

  /** Выданные access-токены живут до своего срока — отметка закрывает их сразу. */
  private async markBlocked(userId: string): Promise<void> {
    const ttl = Math.max(this.config.accessTtlSeconds, ADMIN_ACCESS_TTL_SECONDS);
    await this.redis.set(blockedUserKey(userId), '1', 'EX', ttl);
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return user;
  }
}
