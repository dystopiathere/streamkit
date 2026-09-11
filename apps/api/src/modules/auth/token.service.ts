import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Выпуск и ротация токенов.
 *
 * Схема: короткий access-JWT плюс долгоживущий refresh-токен со СЛУЧАЙНЫМ значением
 * (не JWT), хранимый в БД хэшем. Каждое обновление выпускает новый refresh и гасит
 * старый.
 *
 * Ключевая защита — детект переиспользования: если кто-то предъявил уже
 * погашенный токен, значит копия утекла. Мы не знаем, кто из двоих настоящий
 * владелец, поэтому гасим всё семейство и заставляем логиниться заново.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  private get accessTtl(): number {
    return this.config.accessTtlSeconds;
  }

  private get refreshTtlMs(): number {
    return this.config.refreshTtlMs;
  }

  async issueAccessToken(user: Pick<User, 'id' | 'email'>): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, email: user.email }, { expiresIn: this.accessTtl });
  }

  /** Новая сессия: новое семейство refresh-токенов. */
  async startSession(
    user: Pick<User, 'id' | 'email'>,
    context: AuditContext = {},
  ): Promise<IssuedTokens> {
    return this.issuePair(user, randomUUID(), context);
  }

  /**
   * Обмен refresh-токена на новую пару.
   *
   * Погашение старого токена сделано атомарным `updateMany` с условием
   * `revokedAt: null`: при гонке двух параллельных обновлений ровно одно
   * получит count === 1, второе честно уйдёт в ветку переиспользования.
   */
  async rotate(
    rawToken: string,
    context: AuditContext = {},
  ): Promise<IssuedTokens & { user: User }> {
    const tokenHash = this.crypto.hashToken(rawToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) {
      throw new UnauthorizedException('Сессия недействительна');
    }

    if (record.revokedAt) {
      await this.revokeFamily(record.familyId);
      await this.audit.record('auth.refresh.reuse_detected', record.userId, {
        ...context,
        metadata: { familyId: record.familyId },
      });
      throw new UnauthorizedException('Сессия недействительна');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Сессия истекла');
    }

    if (record.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Учётная запись недоступна');
    }

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });

    if (claimed.count !== 1) {
      // Кто-то успел раньше — значит токен предъявлен дважды.
      await this.revokeFamily(record.familyId);
      await this.audit.record('auth.refresh.reuse_detected', record.userId, {
        ...context,
        metadata: { familyId: record.familyId, race: true },
      });
      throw new UnauthorizedException('Сессия недействительна');
    }

    const issued = await this.issuePair(record.user, record.familyId, context);
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { replacedById: issued.refreshTokenId },
    });

    return { ...issued, user: record.user };
  }

  private async issuePair(
    user: Pick<User, 'id' | 'email'>,
    familyId: string,
    context: AuditContext,
  ): Promise<IssuedTokens & { refreshTokenId: string }> {
    const rawRefresh = this.crypto.generateToken(32);
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlMs);

    const created = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: this.crypto.hashToken(rawRefresh),
        userAgent: context.userAgent ?? null,
        ipHash: context.ipHash ?? null,
        expiresAt: refreshExpiresAt,
      },
      select: { id: true },
    });

    return {
      accessToken: await this.issueAccessToken(user),
      expiresIn: this.accessTtl,
      refreshToken: rawRefresh,
      refreshExpiresAt,
      refreshTokenId: created.id,
    };
  }

  /** Гасит всё семейство — используется при выходе и при детекте кражи. */
  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByToken(rawToken: string): Promise<void> {
    const tokenHash = this.crypto.hashToken(rawToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (record) {
      await this.revokeFamily(record.familyId);
    }
  }

  /** Выход со всех устройств: например, после смены пароля. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Активные сессии пользователя. Группируем по семейству: одно семейство —
   * одно устройство, сколько бы ротаций внутри него ни произошло.
   */
  async listSessions(userId: string, currentRawToken?: string) {
    const currentHash = currentRawToken ? this.crypto.hashToken(currentRawToken) : null;
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    const byFamily = new Map<string, (typeof tokens)[number]>();
    for (const token of tokens) {
      const existing = byFamily.get(token.familyId);
      if (!existing || existing.createdAt < token.createdAt) {
        byFamily.set(token.familyId, token);
      }
    }

    return [...byFamily.values()].map((token) => ({
      id: token.familyId,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt.toISOString(),
      userAgent: token.userAgent,
      ipHash: token.ipHash,
      isCurrent: currentHash !== null && token.tokenHash === currentHash,
    }));
  }

  /** Удаление протухших записей. Вызывается по расписанию из worker. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
