import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MailKind, MailStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAILER, type Mailer, type MailMessage } from './mailer';

/**
 * Письма, которые уходят и без подтверждённой почты.
 *
 * Подтверждение — очевидно. Восстановление пароля — потому что это второй путь
 * доказать, что ящик свой: задать пароль по ссылке может только владелец
 * ящика, и `PasswordResetService` после этого считает почту подтверждённой.
 * Закрыть его значило бы запереть в аккаунте того, кто забыл пароль, не успев
 * подтвердить адрес.
 */
const ALLOWED_UNVERIFIED: ReadonlySet<MailKind> = new Set(['EMAIL_VERIFICATION', 'PASSWORD_RESET']);

export interface MailRecipient {
  id: string;
  emailVerifiedAt: Date | null;
}

export type MailOutcome = 'sent' | 'skipped';

/**
 * Отправка письма владельцу аккаунта: проверка подтверждения и журнал.
 *
 * Все служебные письма пользователю идут через этот сервис, а не через
 * `MAILER` напрямую: иначе правило «без подтверждения — ничего» пришлось бы
 * помнить в каждом отправителе, а поддержка не видела бы, что письмо ушло.
 * Журнал — только вид и исход (`MailLog`).
 */
@Injectable()
export class AccountMailService {
  private readonly logger = new Logger(AccountMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  get configured(): boolean {
    return this.mailer.configured;
  }

  /**
   * @returns `skipped`, если почта не подтверждена и письмо этого вида ей не положено.
   * @throws ошибку почтового сервера — вызывающий решает, повторять ли.
   */
  async send(recipient: MailRecipient, kind: MailKind, message: MailMessage): Promise<MailOutcome> {
    if (!recipient.emailVerifiedAt && !ALLOWED_UNVERIFIED.has(kind)) {
      await this.log(recipient.id, kind, 'SKIPPED_UNVERIFIED');
      return 'skipped';
    }

    try {
      await this.mailer.send(message);
    } catch (error) {
      await this.log(recipient.id, kind, 'FAILED');
      throw error;
    }
    await this.log(recipient.id, kind, 'SENT');
    return 'sent';
  }

  /** Сбой журнала не отменяет письмо: оно уже ушло или уже не ушло. */
  private async log(userId: string, kind: MailKind, status: MailStatus): Promise<void> {
    try {
      await this.prisma.mailLog.create({ data: { userId, kind, status } });
    } catch (error) {
      this.logger.warn(
        { userId, kind, error: error instanceof Error ? error.message : String(error) },
        'Запись в журнал писем не удалась',
      );
    }
  }
}
