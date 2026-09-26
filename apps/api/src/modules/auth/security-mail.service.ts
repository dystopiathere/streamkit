import { Injectable, Logger } from '@nestjs/common';
import type { MailKind } from '@prisma/client';
import { mailLanguageSchema } from '@streamkit/contracts';
import type { AuditContext } from '../../common/audit/audit.service';
import { AccountMailService } from '../../common/mail/account-mail.service';
import type { MailMessage } from '../../common/mail/mailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import {
  newDeviceMessage,
  passwordChangedMessage,
  type SecurityMailInput,
  totpDisabledMessage,
} from './security-mail';

/**
 * Письма о событиях безопасности: смена пароля, вход с нового устройства,
 * выключение второго фактора.
 *
 * Письмо уходит, не задерживая ответ, и его сбой не отменяет действие: пароль
 * уже сменён, и сообщать человеку «не получилось», когда получилось, нельзя.
 * Сбой пишется в журнал без адреса — только идентификатор аккаунта.
 * Неподтверждённой почте эти письма не уходят (`AccountMailService`).
 */
@Injectable()
export class SecurityMailService {
  private readonly logger = new Logger(SecurityMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly mail: AccountMailService,
  ) {}

  passwordChanged(userId: string, via: 'settings' | 'reset', context: AuditContext = {}): void {
    this.dispatch(userId, context, 'PASSWORD_CHANGED', (input) =>
      passwordChangedMessage({ ...input, via }),
    );
  }

  newDevice(userId: string, context: AuditContext = {}): void {
    this.dispatch(userId, context, 'NEW_DEVICE', newDeviceMessage);
  }

  totpDisabled(userId: string, context: AuditContext = {}): void {
    this.dispatch(userId, context, 'TOTP_DISABLED', totpDisabledMessage);
  }

  private dispatch(
    userId: string,
    context: AuditContext,
    kind: MailKind,
    build: (input: SecurityMailInput) => MailMessage,
  ): void {
    if (!this.mail.configured) return;
    const at = new Date();
    void this.send(userId, context, kind, at, build).catch((error: unknown) => {
      this.logger.error(
        { userId, kind, error: error instanceof Error ? error.message : String(error) },
        'Письмо о безопасности не отправлено',
      );
    });
  }

  private async send(
    userId: string,
    context: AuditContext,
    kind: MailKind,
    at: Date,
    build: (input: SecurityMailInput) => MailMessage,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        language: true,
        status: true,
        emailVerifiedAt: true,
      },
    });
    if (!user || user.status !== 'ACTIVE') return;

    await this.mail.send(
      user,
      kind,
      build({
        email: user.email,
        displayName: user.displayName,
        language: mailLanguageSchema.catch('ru').parse(user.language),
        at,
        userAgent: context.userAgent ?? null,
        webBaseUrl: this.config.webBaseUrl,
      }),
    );
  }
}
