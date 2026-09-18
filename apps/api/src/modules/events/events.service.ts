import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AlertEvent,
  CursorPagination,
  IncomingAlertEvent,
  Language,
  Page,
} from '@streamkit/contracts';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WidgetStateService } from '../widgets/widget-state.service';
import { DedupService } from './dedup.service';
import { toContractEvent, toPrismaEventType, toPrismaProvider } from './event.mappers';

/** Подпись тестового алерта: он уходит в OBS, поэтому на языке дашборда стримера. */
const TEST_EVENT_TEXT: Record<Language, { username: string; message: string }> = {
  ru: { username: 'Тестовый зритель', message: 'Проверка оповещения' },
  en: { username: 'Test viewer', message: 'Checking the alert' },
};

export type IngestResult =
  { status: 'created'; event: AlertEvent } | { status: 'duplicate'; event: null };

/** Код Prisma для нарушения уникального индекса. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dedup: DedupService,
    private readonly bus: RealtimeBus,
    private readonly widgetState: WidgetStateService,
  ) {}

  /**
   * Приём нормализованного события: дедуп → запись → публикация в шину.
   *
   * Порядок не переставлять. Публикация после успешной записи гарантирует, что
   * алерт на стриме соответствует тому, что лежит в истории; обратный порядок
   * приводит к «показали, но не сохранили» при падении БД.
   */
  async ingest(incoming: IncomingAlertEvent): Promise<IngestResult> {
    const isFirstSeen = await this.dedup.claim(
      incoming.userId,
      incoming.provider,
      incoming.externalId,
    );
    if (!isFirstSeen) {
      this.logger.debug({ provider: incoming.provider }, 'Дубль события отброшен по Redis');
      return { status: 'duplicate', event: null };
    }

    let row;
    try {
      row = await this.prisma.alertEvent.create({
        data: {
          userId: incoming.userId,
          type: toPrismaEventType(incoming.type),
          provider: toPrismaProvider(incoming.provider),
          externalId: incoming.externalId,
          username: incoming.username,
          message: incoming.message,
          amountMinor: incoming.amount?.amountMinor ?? null,
          currency: incoming.amount?.currency ?? null,
          isTest: incoming.isTest,
          occurredAt: incoming.occurredAt ? new Date(incoming.occurredAt) : new Date(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        // Redis потерял ключ (перезапуск), но уникальный индекс в БД поймал дубль.
        this.logger.debug({ provider: incoming.provider }, 'Дубль события отброшен по индексу БД');
        return { status: 'duplicate', event: null };
      }

      // Записи нет — снимаем отметку, чтобы повтор провайдера не отбросился
      // молча как «уже обработано».
      await this.dedup.release(incoming.userId, incoming.provider, incoming.externalId);
      throw error;
    }

    const event = toContractEvent(row);

    // Всё, что идёт ПОСЛЕ успешной записи, отметку дедупликации не снимает.
    //
    // Раньше снимало — и это теряло донат насовсем: строка в БД уже есть,
    // ключ снят, провайдер честно повторяет событие, повтор упирается в
    // уникальный индекс и возвращает «дубль». Донат в истории, зрители его
    // не увидели, показать заново нечем. Лучше сохранённое событие без
    // алерта, чем сохранённое событие, которое больше никогда не всплывёт.
    await this.bus
      .publish({ kind: 'alert', userId: incoming.userId, event })
      .catch((error: unknown) =>
        this.logger.error({ err: error, eventId: event.id }, 'Событие записано, но не доставлено'),
      );
    await this.touchSource(incoming);

    // Цель, топ и таймер пересчитываются здесь, а не в шлюзе: шлюз живёт в
    // каждой реплике API, и пересчёт из каждой размножил бы одни и те же
    // сообщения по числу инстансов. Запись события случается ровно один раз.
    await this.widgetState
      .onAlertEvent(incoming.userId, event)
      .catch((error: unknown) =>
        this.logger.warn({ err: error, eventId: event.id }, 'Состояние виджетов не пересчитано'),
      );

    return { status: 'created', event };
  }

  /**
   * Тестовый алерт из дашборда. Отдельный `externalId` на каждый вызов — иначе
   * дедупликация отбросит вторую проверку, и стример решит, что всё сломалось.
   */
  async createTestEvent(userId: string, language: Language = 'ru'): Promise<AlertEvent> {
    const text = TEST_EVENT_TEXT[language];
    const result = await this.ingest({
      userId,
      type: 'donation',
      provider: 'manual',
      externalId: `test-${randomUUID()}`,
      username: text.username,
      message: text.message,
      amount: { amountMinor: 50_000, currency: 'RUB' },
      isTest: true,
      occurredAt: new Date().toISOString(),
    });

    if (result.status === 'duplicate') {
      // Практически недостижимо: externalId уникален на каждый вызов.
      throw new Error('Не удалось создать тестовое событие');
    }
    return result.event;
  }

  /** История событий с курсорной пагинацией: по возрастанию id не листаем — только по времени. */
  async list(userId: string, pagination: CursorPagination): Promise<Page<AlertEvent>> {
    const rows = await this.prisma.alertEvent.findMany({
      where: { userId },
      // id — второй ключ: у событий, пришедших пачкой в одну миллисекунду,
      // порядок иначе не определён, и курсор пропускал или повторял строки.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > pagination.limit;
    const items = hasMore ? rows.slice(0, pagination.limit) : rows;

    return {
      items: items.map(toContractEvent),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async touchSource(incoming: IncomingAlertEvent): Promise<void> {
    if (incoming.provider === 'manual') return;
    await this.prisma.donationSource
      .updateMany({
        where: { userId: incoming.userId, provider: toPrismaProvider(incoming.provider) },
        data: { lastEventAt: new Date() },
      })
      .catch(() => undefined);
  }
}
