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
  | 'billing.renewal.failed'
  | 'billing.autorenew.changed'
  | 'webhook.signature.invalid'
  | 'webhook.replay_rejected'
  | 'privacy.data.exported'
  | 'privacy.account.anonymized'
  | 'consent.granted'
  | 'consent.revoked'
  | 'integration.connected'
  | 'integration.disconnected'
  | 'integration.token.expired'
  | 'integration.state.invalid';

export interface AuditContext {
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
