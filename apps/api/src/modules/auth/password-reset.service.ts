import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type MailLanguage, PASSWORD_RESET_TTL_MINUTES } from '@streamkit/contracts';
import type { Redis } from 'ioredis';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PasswordService } from '../../common/crypto/password.service';
import { MAILER, type Mailer } from '../../common/mail/mailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { AppConfig } from '../../config/app-config.service';
import { passwordResetMessage } from './password-reset-mail';
import { TokenService } from './token.service';

/**
 * Не чаще одного письма в минуту на аккаунт.
 *
 * Лимитер `auth` считает запросы по IP, а письмо уходит на адрес: с разных IP
 * можно было бы засыпать чужой ящик письмами «восстановите пароль». Минута не
 * мешает тому, кто не дождался первого письма и нажал ещё раз.
 */
const MAIL_COOLDOWN_SECONDS = 60;

const INVALID_LINK = 'Ссылка недействительна или устарела';

/**
 * Восстановление пароля по ссылке из письма.
 *
 * Токен — 32 случайных байта; в БД только его HMAC, как у сессий. Ссылка ведёт
 * на `/reset-password#token=…`: фрагмент адреса не уходит на сервер, не оседает
 * в журналах nginx и в Referer — так же устроено приглашение гостя.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Запрос письма. Ответ одинаков для любого адреса — зарегистрированного или
   * нет, — и письмо отправляется, не задерживая ответ: иначе по времени ответа
   * было бы видно, есть ли такой аккаунт. Без почты — 503: это сведение о
   * сервере, а не об аккаунте.
   */
  async request(email: string, language: MailLanguage, context: AuditContext = {}): Promise<void> {
    if (!this.mailer.configured) {
      throw new ServiceUnavailableException('Почта не настроена');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;

    const allowed = await this.redis.set(
      `streamkit:password-reset:${user.id}`,
      '1',
      'EX',
      MAIL_COOLDOWN_SECONDS,
      'NX',
    );
    if (allowed !== 'OK') return;

    const token = this.crypto.generateToken();
    await this.prisma.$transaction([
      // В ящике работает только последнее письмо: иначе ссылка из письма,
      // которое человек уже удалил, открывала бы смену пароля ещё час.
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.crypto.hashToken(token),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
        },
      }),
    ]);
    await this.audit.record('auth.password.reset_requested', user.id, context);

    const base = this.config.webBaseUrl.replace(/\/+$/, '');
    const message = passwordResetMessage({
      email: user.email,
      displayName: user.displayName,
      link: `${base}/reset-password#token=${token}`,
      language,
    });
    // Без await — см. комментарий к методу. Сбой почты пишется в журнал без
    // адреса и без ссылки: ссылка и есть доступ к аккаунту.
    void this.mailer.send(message).catch((error: unknown) => {
      this.logger.error(
        { userId: user.id, error: error instanceof Error ? error.message : String(error) },
        'Письмо восстановления пароля не отправлено',
      );
    });
  }

  /**
   * Новый пароль по ссылке.
   *
   * Токен расходуется условным `updateMany` по `usedAt: null`: два запроса с
   * одной ссылкой не сменят пароль дважды. Смена гасит все сессии — забытый
   * пароль нередко значит, что им уже пользуется кто-то ещё. Второй фактор
   * остаётся: восстановление пароля не должно обходить код из приложения.
   */
  async reset(rawToken: string, newPassword: string, context: AuditContext = {}): Promise<void> {
    const tokenHash = this.crypto.hashToken(rawToken);
    const now = new Date();
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt <= now || record.user.status !== 'ACTIVE') {
      throw new BadRequestException(INVALID_LINK);
    }

    const passwordHash = await this.passwords.hash(newPassword);
    const consumed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count === 0) return false;
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      return true;
    });
    if (!consumed) throw new BadRequestException(INVALID_LINK);

    await this.tokens.revokeAllForUser(record.userId);
    await this.audit.record('auth.password.reset', record.userId, context);
  }
}
