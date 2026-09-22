import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AlertEvent,
  AlertEventType,
  CursorPagination,
  EventsPage,
  EventsPageQuery,
  EventsResetResult,
  IncomingAlertEvent,
  Language,
  Money,
  Page,
} from '@streamkit/contracts';
import { type AuditContext, AuditService } from '../../common/audit/audit.service';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WidgetStateService } from '../widgets/widget-state.service';
import { DedupService } from './dedup.service';
import { toContractEvent, toPrismaEventType, toPrismaProvider } from './event.mappers';

/** Подпись тестового алерта: он уходит в OBS, поэтому на языке дашборда стримера. */
const TEST_EVENT_TEXT: Record<Language, { username: string; message: string; reward: string }> = {
  ru: { username: 'Тестовый зритель', message: 'Проверка оповещения', reward: 'Выбрать игру' },
  en: { username: 'Test viewer', message: 'Checking the alert', reward: 'Pick the game' },
};

/**
 * Пример события для проверки сценария: у каждого типа — то, что у него
 * бывает на самом деле. Сумма только у доната, количество — у подарков,
 * продлений, битов и рейда: шаблон проверяется с теми же переменными, что
 * придут в эфире.
 */
function testSample(
  type: AlertEventType,
  text: (typeof TEST_EVENT_TEXT)[Language],
  amount?: Money,
): Pick<IncomingAlertEvent, 'message' | 'amount' | 'count'> {
  switch (type) {
    // Сумму можно задать: так проверяют триггер «донат от тысячи».
    case 'donation':
      return {
        message: text.message,
        amount: amount ?? { amountMinor: 50_000, currency: 'RUB' },
        count: null,
      };
    case 'gift':
      return { message: '', amount: null, count: 5 };
    case 'resubscription':
      return { message: text.message, amount: null, count: 12 };
    case 'cheer':
      return { message: text.message, amount: null, count: 500 };
    case 'raid':
      return { message: '', amount: null, count: 42 };
    case 'reward':
      return { message: text.reward, amount: null, count: null };
    case 'follow':
    case 'subscription':
      return { message: '', amount: null, count: null };
  }
}

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
    private readonly audit: AuditService,
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
          audioUrl: incoming.audioUrl,
          amountMinor: incoming.amount?.amountMinor ?? null,
          currency: incoming.amount?.currency ?? null,
          count: incoming.count,
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
  async createTestEvent(
    userId: string,
    type: AlertEventType = 'donation',
    language: Language = 'ru',
    amount?: Money,
  ): Promise<AlertEvent> {
    const text = TEST_EVENT_TEXT[language];
    const result = await this.ingest({
      userId,
      type,
      provider: 'manual',
      externalId: `test-${randomUUID()}`,
      username: text.username,
      ...testSample(type, text, amount),
      // Тестовый алерт — без голосового доната: записи у него нет.
      audioUrl: null,
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

  /**
   * Страница истории для раздела «События».
   *
   * Страницы считаются от отсечки `until`, а не от «сейчас»: иначе донат,
   * пришедший между переходами, сдвигал бы все строки, и последняя строка
   * первой страницы повторялась первой строкой второй. Первая страница
   * отсечку назначает, следующие её передают.
   */
  async page(userId: string, query: EventsPageQuery): Promise<EventsPage> {
    const until = query.until ? new Date(query.until) : new Date();
    const where = { userId, createdAt: { lte: until } };
    const [total, rows] = await Promise.all([
      this.prisma.alertEvent.count({ where }),
      this.prisma.alertEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(toContractEvent),
      total,
      page: query.page,
      pageSize: query.pageSize,
      until: until.toISOString(),
    };
  }

  /**
   * Обнуление истории событий: донаты, фолловеры, подписки — всё.
   *
   * Удаление, а не флажок «скрыто»: стример просит убрать данные, а не
   * спрятать их. Вместе с историей обнуляются цель и топ донатеров — они
   * считаются по событиям запросом, а не хранят свою сумму (см. `raisedMinor`),
   * поэтому отдельного «сбросить цель» здесь нет: он был бы вторым источником
   * правды о той же сумме.
   *
   * Стартовая сумма цели (`offsetMinor`) остаётся: её задал сам стример в
   * настройках виджета, это не собранные деньги, а точка отсчёта.
   *
   * Таймер марафона не трогаем: его остаток — это время, а не сумма, и
   * обнулять идущий отсчёт вместе с историей донатов никто не просил. Остаток
   * там хранится, а не считается, и сбрасывается кнопками таймера.
   */
  async resetHistory(userId: string, context: AuditContext = {}): Promise<EventsResetResult> {
    const removed = await this.prisma.alertEvent.deleteMany({ where: { userId } });

    // Пересчёт и рассылка — после удаления: сцены в OBS обязаны показать нули
    // немедленно, иначе цель висит с прежней суммой до следующего доната.
    // История рулетки — имена донатеров и суммы, то есть та же история
    // донатов. Стирается здесь же и у выключенных виджетов, и не рассылкой, а
    // удалением строки: сбой рассылки не должен оставлять имена в базе.
    await this.prisma.widgetState.deleteMany({ where: { widget: { userId, type: 'ROULETTE' } } });

    const widgets = await this.prisma.widget.findMany({
      where: {
        userId,
        isEnabled: true,
        type: { in: ['GOAL', 'TOP_DONORS', 'LATEST', 'ROULETTE'] },
      },
    });
    for (const widget of widgets) {
      await this.widgetState
        .publish(widget)
        .catch((error: unknown) =>
          this.logger.warn({ err: error, widgetId: widget.id }, 'Состояние виджета не разослано'),
        );
    }

    await this.audit.record('events.history.reset', userId, {
      ...context,
      // Ни имён, ни сумм: в журнал идёт только объём. Имена донатеров — данные
      // третьих лиц, и в аудит они не попадают ни при каком действии.
      metadata: { ...context.metadata, removedEvents: removed.count },
    });

    return { removedEvents: removed.count, refreshedWidgets: widgets.length };
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
