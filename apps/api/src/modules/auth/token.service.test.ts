import { randomBytes, randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { RefreshToken, User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AppConfig } from '../../config/app-config.service';
import { TokenService } from './token.service';

/**
 * Хранилище refresh-токенов в памяти.
 *
 * Мокаем именно поведение Prisma, а не сам сервис: проверяемая логика — это
 * условный `updateMany`, которым выигрывается гонка при одновременном обновлении.
 * Мок с наивным `update` эту логику бы не воспроизвёл и тест стал бы бессмысленным.
 */
function createPrismaMock() {
  const rows = new Map<string, RefreshToken>();
  const user: User = {
    id: randomUUID(),
    email: 'streamer@example.com',
    passwordHash: 'hash',
    displayName: 'Стример',
    status: 'ACTIVE',
    isTotpEnabled: false,
    totpSecretEncrypted: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    anonymizedAt: null,
  };

  const prisma = {
    refreshToken: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          userId: data.userId as string,
          familyId: data.familyId as string,
          tokenHash: data.tokenHash as string,
          userAgent: (data.userAgent as string | null) ?? null,
          ipHash: (data.ipHash as string | null) ?? null,
          expiresAt: data.expiresAt as Date,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          revokedAt: null,
          replacedById: null,
        } satisfies RefreshToken;
        rows.set(row.id, row);
        return row;
      }),

      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const row = [...rows.values()].find((item) => item.tokenHash === where.tokenHash);
        return row ? { ...row, user } : null;
      }),

      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; familyId?: string; userId?: string; revokedAt?: null };
          data: Partial<RefreshToken>;
        }) => {
          let count = 0;
          for (const row of rows.values()) {
            if (where.id && row.id !== where.id) continue;
            if (where.familyId && row.familyId !== where.familyId) continue;
            if (where.userId && row.userId !== where.userId) continue;
            if (where.revokedAt === null && row.revokedAt !== null) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      ),

      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<RefreshToken> }) => {
          const row = rows.get(where.id);
          if (row) Object.assign(row, data);
          return row;
        },
      ),

      findMany: vi.fn(async () => [...rows.values()].filter((row) => row.revokedAt === null)),
    },
  };

  return { prisma: prisma as unknown as PrismaService, rows, user };
}

function createService() {
  const { prisma, rows, user } = createPrismaMock();

  const crypto = new CryptoService({
    encryptionKey: randomBytes(32),
    ipHashPepper: 'pepper-for-tests-0123456789',
  } as AppConfig);

  const jwt = { signAsync: vi.fn(async () => 'access.jwt.token') } as unknown as JwtService;
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const config = { accessTtlSeconds: 900, refreshTtlMs: 30 * 24 * 60 * 60 * 1000 } as AppConfig;

  return {
    service: new TokenService(prisma, jwt, crypto, audit, config),
    rows,
    user,
    audit,
  };
}

describe('TokenService', () => {
  let harness: ReturnType<typeof createService>;

  beforeEach(() => {
    harness = createService();
  });

  it('выдаёт пару токенов и сохраняет только хэш refresh-токена', async () => {
    const issued = await harness.service.startSession(harness.user);

    expect(issued.accessToken).toBe('access.jwt.token');
    expect(issued.refreshToken).toBeTruthy();

    const stored = [...harness.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(issued.refreshToken);
  });

  it('обменивает refresh на новую пару и гасит старый токен', async () => {
    const first = await harness.service.startSession(harness.user);
    const second = await harness.service.rotate(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);

    const revoked = [...harness.rows.values()].filter((row) => row.revokedAt !== null);
    expect(revoked).toHaveLength(1);
  });

  it('сохраняет семейство при ротации — это одно устройство', async () => {
    const first = await harness.service.startSession(harness.user);
    await harness.service.rotate(first.refreshToken);

    const families = new Set([...harness.rows.values()].map((row) => row.familyId));
    expect(families.size).toBe(1);
  });

  it('при повторном использовании токена гасит всё семейство', async () => {
    const first = await harness.service.startSession(harness.user);
    await harness.service.rotate(first.refreshToken);

    // Злоумышленник предъявляет украденную копию уже использованного токена.
    await expect(harness.service.rotate(first.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const alive = [...harness.rows.values()].filter((row) => row.revokedAt === null);
    expect(alive).toHaveLength(0);
    expect(harness.audit.record).toHaveBeenCalledWith(
      'auth.refresh.reuse_detected',
      expect.any(String),
      expect.anything(),
    );
  });

  it('после детекта кражи новый токен, выданный вором, тоже мёртв', async () => {
    const first = await harness.service.startSession(harness.user);
    const stolenRotation = await harness.service.rotate(first.refreshToken);

    await harness.service.rotate(first.refreshToken).catch(() => undefined);

    await expect(harness.service.rotate(stolenRotation.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('отвергает неизвестный токен', async () => {
    await expect(harness.service.rotate('никогда-не-выдавался')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('отвергает истёкший токен', async () => {
    const issued = await harness.service.startSession(harness.user);
    for (const row of harness.rows.values()) {
      row.expiresAt = new Date(Date.now() - 1000);
    }

    await expect(harness.service.rotate(issued.refreshToken)).rejects.toThrow('истекла');
  });

  it('не пускает пользователя с неактивным статусом', async () => {
    const issued = await harness.service.startSession(harness.user);
    harness.user.status = 'ANONYMIZED';

    await expect(harness.service.rotate(issued.refreshToken)).rejects.toThrow('недоступна');
  });

  it('выход гасит все сессии пользователя', async () => {
    await harness.service.startSession(harness.user);
    await harness.service.startSession(harness.user);

    await harness.service.revokeAllForUser(harness.user.id);

    expect([...harness.rows.values()].every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('показывает по одной записи на устройство, а не на каждую ротацию', async () => {
    const first = await harness.service.startSession(harness.user);
    await harness.service.rotate(first.refreshToken);
    await harness.service.startSession(harness.user);

    const sessions = await harness.service.listSessions(harness.user.id);
    expect(sessions).toHaveLength(2);
  });
});
