import {
  type Channel as PrismaChannel,
  ChannelSyncState as PrismaSyncState,
  Platform as PrismaPlatform,
} from '@prisma/client';
import type { Channel, ChannelSyncState, Platform } from '@streamkit/contracts';

/**
 * Перевод между энумами БД (UPPER_SNAKE, требование Prisma) и контрактами.
 *
 * Таблицы заданы явно, а не через `toUpperCase()`: так добавление значения в
 * один из энумов ломает компиляцию, а не молча не сматчивается в рантайме.
 *
 * Обратная таблица неполная по замыслу: энум `Platform` в БД содержит VKPLAY и
 * TROVO под будущие коннекторы, а контракт описывает только то, что реально
 * собирает метрики. Строка с такой площадкой в выборку аналитики попасть не
 * может — фильтр стоит в запросе.
 */
const PLATFORM_TO_PRISMA: Record<Platform, PrismaPlatform> = {
  twitch: PrismaPlatform.TWITCH,
  youtube: PrismaPlatform.YOUTUBE,
};

const PLATFORM_FROM_PRISMA: Partial<Record<PrismaPlatform, Platform>> = {
  TWITCH: 'twitch',
  YOUTUBE: 'youtube',
};

const SYNC_STATE_FROM_PRISMA: Record<PrismaSyncState, ChannelSyncState> = {
  OK: 'ok',
  AUTH_EXPIRED: 'auth-expired',
  RATE_LIMITED: 'rate-limited',
  ERROR: 'error',
};

const SYNC_STATE_TO_PRISMA: Record<ChannelSyncState, PrismaSyncState> = {
  ok: PrismaSyncState.OK,
  'auth-expired': PrismaSyncState.AUTH_EXPIRED,
  'rate-limited': PrismaSyncState.RATE_LIMITED,
  error: PrismaSyncState.ERROR,
};

export function toContractSyncState(state: PrismaSyncState): ChannelSyncState {
  return SYNC_STATE_FROM_PRISMA[state];
}

export function toPrismaSyncState(state: ChannelSyncState): PrismaSyncState {
  return SYNC_STATE_TO_PRISMA[state];
}

/** Площадки, по которым есть сбор метрик. Ими фильтруются выборки аналитики. */
export const ANALYTICS_PLATFORMS: PrismaPlatform[] = Object.values(PLATFORM_TO_PRISMA);

export function toPrismaPlatform(platform: Platform): PrismaPlatform {
  return PLATFORM_TO_PRISMA[platform];
}

export function toContractPlatform(platform: PrismaPlatform): Platform {
  const mapped = PLATFORM_FROM_PRISMA[platform];
  if (!mapped) {
    throw new Error(`Площадка ${platform} не поддерживает сбор метрик`);
  }
  return mapped;
}

export function toContractChannel(row: PrismaChannel): Channel {
  return {
    id: row.id,
    platform: toContractPlatform(row.platform),
    externalId: row.externalId,
    login: row.login,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    connectedAt: row.createdAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    syncState: SYNC_STATE_FROM_PRISMA[row.syncState],
    // syncError наружу не отдаётся: это текст ошибки площадки, он нужен в логах
    // для диагностики, а пользователю говорит только syncState.
  };
}
