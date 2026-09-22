import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Действия, попадающие в аудит. Строковый union вместо свободной строки —
 * чтобы список событий безопасности был обозрим и не размывался опечатками.
 */
export type AuditAction =
  | 'auth.register'
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'auth.login.totp_failed'
  | 'auth.logout'
  | 'auth.refresh.reuse_detected'
  | 'auth.password.changed'
  | 'auth.totp.enabled'
  | 'auth.totp.disabled'
  | 'overlay.token.created'
  | 'overlay.token.revoked'
  | 'room.created'
  | 'room.deleted'
  | 'room.invite.created'
  | 'room.invite.revoked'
  | 'room.guest.joined'
  | 'room.guest.removed'
  | 'billing.checkout.created'
  | 'billing.payment.succeeded'
  | 'billing.payment.canceled'
  | 'billing.payment.amount_mismatch'
  | 'billing.payment.refunded'
  | 'billing.renewal.failed'
  | 'billing.autorenew.changed'
  | 'billing.payment_method.removed'
  /** Стример выбрал другой тариф или период: применится при продлении. */
  | 'billing.plan.changed'
  | 'webhook.signature.invalid'
  | 'webhook.replay_rejected'
  | 'privacy.data.exported'
  | 'privacy.account.anonymized'
  | 'consent.granted'
  | 'consent.revoked'
  /** Стример или сотрудник обнулил историю событий и донатов. */
  | 'events.history.reset'
  | 'integration.connected'
  | 'integration.disconnected'
  | 'integration.token.expired'
  | 'integration.token.revoked'
  | 'integration.state.invalid'
  /** Стример включил или выключил площадку: активной может быть одна. */
  | 'integration.channel.toggled'
  | 'admin.login.success'
  | 'admin.login.failed'
  | 'admin.logout'
  | 'admin.user.viewed'
  | 'admin.user.suspended'
  | 'admin.user.restored'
  | 'admin.user.anonymized'
  | 'admin.role.changed'
  | 'admin.sessions.revoked'
  | 'admin.totp.reset'
  | 'admin.widget.disabled'
  | 'admin.widget.enabled'
  | 'admin.subscription.extended'
  /** Сотрудник снял подарочные дни. Оплаченные снять нельзя — см. billing. */
  | 'admin.subscription.gift_revoked'
  | 'admin.channel.resync'
  | 'admin.payment.synced';

export interface AuditContext {
  /**
   * Сотрудник, действующий над чужим аккаунтом. Пусто — действует сам владелец.
   * Передаётся дальше в сервисы вместе с контекстом запроса, поэтому их
   * собственные записи (отзыв ссылки, удаление комнаты) тоже получают автора.
   */
  actorId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Запись в аудит никогда не должна ломать основной сценарий: пользователь не
   * виноват, что упала вставка лога. Поэтому ошибки только логируем.
   */
  async record(
    action: AuditAction,
    userId: string | null,
    context: AuditContext = {},
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          userId,
          actorId: context.actorId ?? null,
          ipHash: context.ipHash ?? null,
          userAgent: context.userAgent ?? null,
          metadata: (context.metadata ?? undefined) as never,
        },
      });
    } catch (error) {
      this.logger.error({ err: error, action }, 'Не удалось записать событие аудита');
    }
  }

  /** Достаёт из запроса то, что можно хранить: хэш IP и обрезанный User-Agent. */
  contextFromRequest(request: Request): AuditContext {
    return {
      ipHash: this.crypto.hashIp(clientIp(request)),
      userAgent: request.headers['user-agent']?.slice(0, 256) ?? null,
    };
  }
}

/**
 * IP клиента. За обратным прокси реальный адрес приходит в X-Forwarded-For,
 * поэтому в main.ts включён `trust proxy` — без него сюда попадёт адрес балансера.
 */
export function clientIp(request: Request): string | undefined {
  return request.ip ?? request.socket.remoteAddress ?? undefined;
}
