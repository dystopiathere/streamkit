import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AuthResult, LoginInput, PublicUser, RegisterInput } from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PasswordService } from '../../common/crypto/password.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LEGAL_DOCUMENTS, REQUIRED_ON_REGISTER } from '../privacy/legal-documents';
import { EmailVerificationService } from './email-verification.service';
import { KnownDeviceService } from './known-device.service';
import { SecurityMailService } from './security-mail.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

export interface LoginOutcome {
  status: 'authenticated' | 'totp-required';
  result?: AuthResult & { refreshToken: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly devices: KnownDeviceService,
    private readonly securityMail: SecurityMailService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  /**
   * @param deviceId — метка браузера из cookie `sk_device` (см. `KnownDeviceService`).
   *   Браузер, в котором зарегистрировались, — первый известный: письма о
   *   «новом устройстве» при первом же входе быть не должно.
   */
  async register(
    input: RegisterInput,
    context: AuditContext = {},
    deviceId?: string,
  ): Promise<AuthResult & { refreshToken: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      // Компромисс: регистрация неизбежно раскрывает занятость email, иначе
      // пользователь не поймёт, почему ничего не работает. Зато логин — не раскрывает.
      throw new ConflictException('Пользователь с таким email уже зарегистрирован');
    }

    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          language: input.language ?? 'ru',
        },
      });

      // Фиксируем версии документов, действовавшие в момент согласия.
      await tx.consent.createMany({
        data: REQUIRED_ON_REGISTER.map((document) => ({
          userId: created.id,
          document,
          documentVersion: LEGAL_DOCUMENTS[document].version,
          ipHash: context.ipHash ?? null,
          userAgent: context.userAgent ?? null,
        })),
      });

      return created;
    });

    await this.audit.record('auth.register', user.id, context);
    this.emailVerification.sendAfterRegistration(user.id);
    if (deviceId) await this.devices.remember(user.id, deviceId, context.userAgent);

    const issued = await this.tokens.startSession(user, context);
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      refreshToken: issued.refreshToken,
      user: toPublicUser(user),
    };
  }

  /**
   * Логин.
   *
   * Ответ «неверный email или пароль» одинаков для несуществующего пользователя
   * и неверного пароля, а время ответа выровнено фиктивной проверкой хэша —
   * иначе логин превращается в оракул для перебора адресов.
   *
   * Вход из браузера, которого у аккаунта не было, — письмо владельцу. Только
   * после второго фактора: без кода вход не состоялся.
   *
   * @param deviceId — метка браузера из cookie `sk_device`; её нет — браузер новый.
   */
  async login(
    input: LoginInput,
    context: AuditContext = {},
    deviceId?: string,
  ): Promise<LoginOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    const passwordValid = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);

    if (!user || !passwordValid) {
      await this.audit.record('auth.login.failed', user?.id ?? null, {
        ...context,
        metadata: { email: user ? undefined : 'unknown' },
      });
      throw new UnauthorizedException('Неверный email или пароль');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Учётная запись недоступна');
    }

    if (user.isTotpEnabled) {
      if (!input.totpCode) {
        return { status: 'totp-required' };
      }
      if (
        !this.verifyTotpFor(user, input.totpCode) ||
        !(await this.totp.consume(user.id, input.totpCode))
      ) {
        await this.audit.record('auth.login.totp_failed', user.id, context);
        throw new UnauthorizedException('Неверный код подтверждения');
      }
    }

    await this.audit.record('auth.login.success', user.id, context);

    if (input.language && input.language !== user.language) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { language: input.language },
      });
    }
    if (deviceId && (await this.devices.remember(user.id, deviceId, context.userAgent))) {
      this.securityMail.newDevice(user.id, context);
    }

    const issued = await this.tokens.startSession(user, context);
    return {
      status: 'authenticated',
      result: {
        accessToken: issued.accessToken,
        expiresIn: issued.expiresIn,
        refreshToken: issued.refreshToken,
        user: toPublicUser(user),
      },
    };
  }

  /**
   * Обновление сессии запоминает браузер молча: сессия в нём уже открыта, и
   * он не новый. Так браузеры, где вошли до появления писем о новом
   * устройстве, становятся известными без письма при первом обновлении.
   */
  async refresh(
    rawToken: string,
    context: AuditContext = {},
    deviceId?: string,
  ): Promise<AuthResult & { refreshToken: string }> {
    const rotated = await this.tokens.rotate(rawToken, context);
    if (deviceId) await this.devices.remember(rotated.user.id, deviceId, context.userAgent);
    return {
      accessToken: rotated.accessToken,
      expiresIn: rotated.expiresIn,
      refreshToken: rotated.refreshToken,
      user: toPublicUser(rotated.user),
    };
  }

  async logout(rawToken: string | undefined, userId: string | null, context: AuditContext = {}) {
    if (rawToken) {
      await this.tokens.revokeByToken(rawToken);
    }
    await this.audit.record('auth.logout', userId, context);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Учётная запись недоступна');
    }
    return toPublicUser(user);
  }

  /**
   * Смена пароля гасит все сессии, включая текущую: если пароль меняют из-за
   * подозрения на компрометацию, оставлять чужую активную сессию бессмысленно.
   * Устройству, с которого сменили пароль, выдаётся новая сессия — новым
   * семейством, а не продлением погашенного.
   *
   * Неверный текущий пароль — 400, а не 401: 401 клиент понимает как протухший
   * access-токен, обновляет его и повторяет запрос, а человек просто ошибся.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: AuditContext = {},
  ): Promise<AuthResult & { refreshToken: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new BadRequestException('Текущий пароль указан неверно');
    }
    if (await this.passwords.verify(user.passwordHash, newPassword)) {
      throw new BadRequestException('Новый пароль совпадает с текущим');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record('auth.password.changed', userId, context);
    this.securityMail.passwordChanged(userId, 'settings', context);

    const issued = await this.tokens.startSession(user, context);
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      refreshToken: issued.refreshToken,
      user: toPublicUser(user),
    };
  }

  /** Шаг 1 подключения 2FA: выдаём секрет и QR, но ещё не включаем. */
  async beginTotpSetup(userId: string): Promise<{ secret: string; qrDataUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isTotpEnabled) {
      throw new BadRequestException('Двухфакторная аутентификация уже включена');
    }

    const secret = this.totp.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEncrypted: this.crypto.encrypt(secret) },
    });

    return { secret, qrDataUrl: await this.totp.buildQrDataUrl(user.email, secret) };
  }

  /** Шаг 2: включаем только после успешной проверки кода — иначе можно запереть себя. */
  async confirmTotpSetup(userId: string, code: string, context: AuditContext = {}): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecretEncrypted) {
      throw new BadRequestException('Сначала запросите секрет');
    }
    // Код подтверждения расходуется, как код входа: иначе тот же код ещё
    // полторы минуты открывал бы вход с только что включённым вторым фактором.
    if (!this.verifyTotpFor(user, code) || !(await this.totp.consume(userId, code))) {
      throw new BadRequestException('Неверный код подтверждения');
    }

    await this.prisma.user.update({ where: { id: userId }, data: { isTotpEnabled: true } });
    await this.audit.record('auth.totp.enabled', userId, context);
  }

  /**
   * Выключение второго фактора — паролем и кодом из приложения.
   *
   * 400, а не 401, на неверный пароль или код: 401 клиент понимает как
   * протухший access-токен и уходит его обновлять, а человек просто ошибся.
   */
  async disableTotp(
    userId: string,
    password: string,
    code: string,
    context: AuditContext = {},
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new BadRequestException('Пароль указан неверно');
    }
    if (
      user.isTotpEnabled &&
      (!this.verifyTotpFor(user, code) || !(await this.totp.consume(userId, code)))
    ) {
      await this.audit.record('auth.totp.disable_failed', userId, context);
      throw new BadRequestException('Неверный код подтверждения');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { isTotpEnabled: false, totpSecretEncrypted: null },
    });
    // Вход в админку — только со вторым фактором, и сессия, открытая с ним, без
    // него жить не должна. Выданный админский access-токен закрывает AdminGuard.
    await this.tokens.revokeAllForUser(userId, 'ADMIN');
    await this.audit.record('auth.totp.disabled', userId, context);
    this.securityMail.totpDisabled(userId, context);
  }

  private verifyTotpFor(user: User, code: string): boolean {
    if (!user.totpSecretEncrypted) return false;
    try {
      return this.totp.verify(this.crypto.decrypt(user.totpSecretEncrypted), code);
    } catch {
      return false;
    }
  }
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isTotpEnabled: user.isTotpEnabled,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}
