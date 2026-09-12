import { type Widget as PrismaWidget, WidgetType as PrismaWidgetType } from '@prisma/client';
import {
  configSchemaFor,
  type Widget,
  type WidgetConfig,
  type WidgetType,
} from '@streamkit/contracts';

/**
 * Перевод типа виджета между энумом БД (UPPER_SNAKE, требование Prisma) и
 * контрактом.
 *
 * Таблицы заданы явно, а не через `toUpperCase()` с заменой дефиса: так новый
 * тип ломает компиляцию здесь, а не молча не сматчивается в рантайме — а
 * «молча» для виджета означает пустой экран в эфире.
 */
const TO_PRISMA: Record<WidgetType, PrismaWidgetType> = {
  alerts: PrismaWidgetType.ALERTS,
  goal: PrismaWidgetType.GOAL,
  timer: PrismaWidgetType.TIMER,
  'top-donors': PrismaWidgetType.TOP_DONORS,
  chat: PrismaWidgetType.CHAT,
};

const FROM_PRISMA: Record<PrismaWidgetType, WidgetType> = {
  ALERTS: 'alerts',
  GOAL: 'goal',
  TIMER: 'timer',
  TOP_DONORS: 'top-donors',
  CHAT: 'chat',
};

export function toPrismaWidgetType(type: WidgetType): PrismaWidgetType {
  return TO_PRISMA[type];
}

export function toContractWidgetType(type: PrismaWidgetType): WidgetType {
  return FROM_PRISMA[type];
}

/**
 * Конфиг из БД, разобранный схемой СВОЕГО типа.
 *
 * Тип известен только в рантайме — он лежит в строке, а не в сигнатуре.
 * Поэтому и понадобился реестр схем в контрактах: раньше во всех таких местах
 * стояла схема алертов, и новый тип пришлось бы вписывать в каждое из них.
 */
export function parseWidgetConfig(type: PrismaWidgetType, raw: unknown): WidgetConfig {
  const contractType = toContractWidgetType(type);
  return {
    type: contractType,
    config: configSchemaFor(contractType).parse(raw),
  } as WidgetConfig;
}

export function toContractWidget(row: PrismaWidget): Widget {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    isEnabled: row.isEnabled,
    ...parseWidgetConfig(row.type, row.config),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
