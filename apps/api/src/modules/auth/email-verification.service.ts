import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EMAIL_VERIFICATION_TTL_HOURS, mailLanguageSchema } from '@streamkit/contracts';
import type { Redis } from 'ioredis';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AccountMailService } from '../../common/mail/account-mail.service';
import { mailUrl } from '../../common/mail/mail-text';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { AppConfig } from '../../config/app-config.service';
import { emailVerificationMessage } from './email-verification-mail';

/** Не чаще письма в минуту на аккаунт — как у восстановления пароля. */
const MAIL_COOLDOWN_SECONDS = 60;

const INVALID_LINK = 'Ссылка недействительна или устарела';
const TOO_OFTEN = 'Письмо уже отправлено. Новое можно запросить через минуту';

/**
 * Подтверждение почты.
 *
 * Ссылка устроена как у восстановления пароля: 32 случайных байта во
 * фрагменте адреса `/verify-email#token=…`, в БД только HMAC, новая ссылка
 * гасит прежние. Подтверждает ссылка сама по себе, без сессии: письмо часто
 * открывают на телефоне, где в дашборд не входили.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly mail: AccountMailService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Письмо после регистрации. Не задерживает ответ и не отменяет регистрацию
   * при сбое почты: письмо можно запросить заново из дашборда.
   */
  sendAfterRegistration(userId: string): void {
    if (!this.mail.configured) return;
    void this.issue(userId).catch((error: unknown) => this.logFailure(userId, error));
  }

  /**
   * Письмо по кнопке в дашборде.
   *
   * @throws 503 без почты, 429 чаще раза в минуту.
   */
  async resend(userId: string): Promise<void> {
    if (!this.mail.configured) throw new ServiceUnavailableException('Почта не настроена');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    if (user.emailVerifiedAt) return;

    const allowed = await this.redis.set(
      `streamkit:email-verification:${userId}`,
      '1',
      'EX',
      MAIL_COOLDOWN_SECONDS,
      'NX',
    );
    if (allowed !== 'OK') throw new HttpException(TOO_OFTEN, HttpStatus.TOO_MANY_REQUESTS);

    await this.issue(userId);
  }

  /**
   * Подтверждение по ссылке.
   *
   * Повторное открытие той же ссылки — не ошибка: человек мог нажать кнопку в
   * письме дважды или открыть его на втором устройстве.
   *
   * @throws 400, если ссылка чужая, истекла или погашена более новой.
   */
  async verify(rawToken: string, context: AuditContext = {}): Promise<void> {
    const now = new Date();
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: this.crypto.hashToken(rawToken) },
      include: { user: { select: { status: true, emailVerifiedAt: true } } },
    });
    if (!record || record.user.status !== 'ACTIVE') throw new BadRequestException(INVALID_LINK);
    if (record.usedAt && record.user.emailVerifiedAt) return;
    if (record.usedAt || record.expiresAt <= now) throw new BadRequestException(INVALID_LINK);

    const consumed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count === 0) return false;
      await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      return true;
    });
    if (!consumed) throw new BadRequestException(INVALID_LINK);

    await this.audit.record('auth.email.verified', record.userId, context);
  }

  private async issue(userId: string): Promise<void> {
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
    if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) return;

    const token = this.crypto.generateToken();
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId,
          tokenHash: this.crypto.hashToken(token),
          expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
        },
      }),
    ]);

    const language = mailLanguageSchema.catch('ru').parse(user.language);
    await this.mail.send(
      user,
      'EMAIL_VERIFICATION',
      emailVerificationMessage({
        email: user.email,
        displayName: user.displayName,
        link: mailUrl(this.config.webBaseUrl, `/verify-email#token=${token}`, language),
        language,
      }),
    );
  }

  /** Без адреса и ссылки: ссылка подтверждает чужой ящик. */
  private logFailure(userId: string, error: unknown): void {
    this.logger.error(
      { userId, error: error instanceof Error ? error.message : String(error) },
      'Письмо подтверждения почты не отправлено',
    );
  }
}
