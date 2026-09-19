import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AdminAuthResult, AdminLoginInput, AdminMe } from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PasswordService } from '../../common/crypto/password.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toPublicUser } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { TotpService } from '../auth/totp.service';
import { toStaffRole } from './admin.mappers';

/**
 * Один ответ на неверный пароль, неверный код и аккаунт без роли. Текст
 * перечисляет все три: прежний «неверные данные» под полем кода читался как
 * «код не подошёл», и первый админ искал ошибку в приложении-аутентификаторе,
 * хотя причина могла быть в роли. Точная причина — в журнале аудита
 * (`admin-status.js`).
 */
const LOGIN_FAILED =
  'Вход не выполнен: неверна почта, пароль или код, либо у аккаунта нет доступа к админке';

type AdminAuthWithRefresh = AdminAuthResult & { refreshToken: string };

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Вход в админку.
   *
   * Неверный пароль, чужая роль и неверный код отвечают одинаково: иначе вход в
   * админку подсказывал бы, какие адреса принадлежат сотрудникам. Отдельный
   * ответ — только сотруднику без второго фактора, и только после верного
   * пароля: ему нужно знать, что делать дальше.
   */
  async login(input: AdminLoginInput, context: AuditContext = {}): Promise<AdminAuthWithRefresh> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordValid = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);

    const fail = async (reason: string): Promise<never> => {
      await this.audit.record('admin.login.failed', user?.id ?? null, {
        ...context,
        metadata: { reason },
      });
      throw new UnauthorizedException(LOGIN_FAILED);
    };

    if (!user || !passwordValid) return fail('password');
    const role = toStaffRole(user.role);
    if (user.status !== 'ACTIVE' || !role) return fail('not-staff');

    if (!user.isTotpEnabled || !user.totpSecretEncrypted) {
      await this.audit.record('admin.login.failed', user.id, {
        ...context,
        metadata: { reason: 'totp-missing' },
      });
      throw new ForbiddenException(
        'Вход в админку — только с двухфакторной аутентификацией. Включите её в дашборде',
      );
    }

    if (!this.verifyTotp(user.totpSecretEncrypted, input.totpCode)) return fail('totp');
    // Код принимается один раз — и здесь, и во входе в дашборд.
    if (!(await this.totp.consume(user.id, input.totpCode))) return fail('totp-replay');

    await this.audit.record('admin.login.success', user.id, context);
    const issued = await this.tokens.startSession(user, context, 'ADMIN');
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      refreshToken: issued.refreshToken,
      user: toAdminMe(user, role),
    };
  }

  async refresh(rawToken: string, context: AuditContext = {}): Promise<AdminAuthWithRefresh> {
    const rotated = await this.tokens.rotate(rawToken, context, 'ADMIN');
    const role = toStaffRole(rotated.user.role);
    if (!role) throw new UnauthorizedException('Доступ к админке закрыт');
    return {
      accessToken: rotated.accessToken,
      expiresIn: rotated.expiresIn,
      refreshToken: rotated.refreshToken,
      user: toAdminMe(rotated.user, role),
    };
  }

  async logout(rawToken: string | undefined, context: AuditContext = {}): Promise<void> {
    if (!rawToken) return;
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.crypto.hashToken(rawToken) },
      select: { familyId: true, userId: true, scope: true },
    });
    // Чужую сессию через этот выход не погасить: только админскую.
    if (!record || record.scope !== 'ADMIN') return;
    await this.tokens.revokeFamily(record.familyId);
    await this.audit.record('admin.logout', record.userId, context);
  }

  async me(userId: string): Promise<AdminMe> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const role = toStaffRole(user.role);
    if (!role) throw new UnauthorizedException('Доступ к админке закрыт');
    return toAdminMe(user, role);
  }

  private verifyTotp(secretEncrypted: string, code: string): boolean {
    try {
      return this.totp.verify(this.crypto.decrypt(secretEncrypted), code);
    } catch {
      return false;
    }
  }
}

function toAdminMe(user: User, role: AdminMe['role']): AdminMe {
  return { ...toPublicUser(user), role };
}
