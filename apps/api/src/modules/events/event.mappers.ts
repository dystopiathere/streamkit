import {
  type AlertEvent as PrismaAlertEvent,
  AlertEventType as PrismaEventType,
  EventProvider as PrismaProvider,
} from '@prisma/client';
import type { AlertEvent, AlertEventType, EventProvider } from '@streamkit/contracts';

/**
 * Перевод между представлением в БД (UPPER_SNAKE, требование Prisma-энумов) и
 * представлением в контрактах (kebab/lower, то, что видит фронт).
 *
 * Таблицы заданы явно, а не через `toUpperCase()`: так добавление значения в один
 * из энумов ломает компиляцию, вместо того чтобы молча не сматчиться в рантайме.
 */
const EVENT_TYPE_TO_PRISMA: Record<AlertEventType, PrismaEventType> = {
  donation: PrismaEventType.DONATION,
  follow: PrismaEventType.FOLLOW,
  subscription: PrismaEventType.SUBSCRIPTION,
  gift: PrismaEventType.GIFT,
  resubscription: PrismaEventType.RESUBSCRIPTION,
  cheer: PrismaEventType.CHEER,
  raid: PrismaEventType.RAID,
  reward: PrismaEventType.REWARD,
};

const EVENT_TYPE_FROM_PRISMA: Record<PrismaEventType, AlertEventType> = {
  DONATION: 'donation',
  FOLLOW: 'follow',
  SUBSCRIPTION: 'subscription',
  GIFT: 'gift',
  RESUBSCRIPTION: 'resubscription',
  CHEER: 'cheer',
  RAID: 'raid',
  REWARD: 'reward',
};

const PROVIDER_TO_PRISMA: Record<EventProvider, PrismaProvider> = {
  donationalerts: PrismaProvider.DONATIONALERTS,
  donatepay: PrismaProvider.DONATEPAY,
  twitch: PrismaProvider.TWITCH,
  youtube: PrismaProvider.YOUTUBE,
  kick: PrismaProvider.KICK,
  webhook: PrismaProvider.WEBHOOK,
  manual: PrismaProvider.MANUAL,
};

const PROVIDER_FROM_PRISMA: Record<PrismaProvider, EventProvider> = {
  DONATIONALERTS: 'donationalerts',
  DONATEPAY: 'donatepay',
  TWITCH: 'twitch',
  YOUTUBE: 'youtube',
  KICK: 'kick',
  WEBHOOK: 'webhook',
  MANUAL: 'manual',
};

export function toPrismaEventType(type: AlertEventType): PrismaEventType {
  return EVENT_TYPE_TO_PRISMA[type];
}

export function toContractEventType(type: PrismaEventType): AlertEventType {
  return EVENT_TYPE_FROM_PRISMA[type];
}

export function toPrismaProvider(provider: EventProvider): PrismaProvider {
  return PROVIDER_TO_PRISMA[provider];
}

export function toContractProvider(provider: PrismaProvider): EventProvider {
  return PROVIDER_FROM_PRISMA[provider];
}

/**
 * Строка БД → контракт. Сумма собирается обратно в объект `Money`; поля
 * `amountMinor` и `currency` заполнены либо оба, либо ни одного — это инвариант,
 * который поддерживают сервисы записи.
 */
export function toContractEvent(row: PrismaAlertEvent): AlertEvent {
  return {
    id: row.id,
    userId: row.userId,
    type: EVENT_TYPE_FROM_PRISMA[row.type],
    provider: PROVIDER_FROM_PRISMA[row.provider],
    externalId: row.externalId,
    username: row.username,
    message: row.message,
    audioUrl: row.audioUrl,
    amount:
      row.amountMinor !== null && row.currency !== null
        ? { amountMinor: row.amountMinor, currency: row.currency as never }
        : null,
    count: row.count,
    isTest: row.isTest,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
