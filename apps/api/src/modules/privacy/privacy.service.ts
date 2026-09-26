import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ConsentDocument } from '@prisma/client';
import type { Redis } from 'ioredis';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { markUserBlocked } from '../../common/auth/access-token';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PasswordService } from '../../common/crypto/password.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { AppConfig } from '../../config/app-config.service';
import { ADMIN_ACCESS_TTL_SECONDS } from '../auth/token.service';
import { RoomEviction } from '../rooms/room-eviction.service';
import { PlatformTokenService } from '../integrations/platform-token.service';
import { WidgetsService } from '../widgets/widgets.service';
import {
  LEGAL_DOCUMENTS,
  type LegalDocument,
  publishedDocuments,
  REQUIRED_ON_REGISTER,
} from './legal-documents';

export interface ConsentView {
  document: ConsentDocument;
  title: string;
  path: string;
  required: boolean;
  /** Принимается только при оплате — раздел «Приватность» кнопку «Принять» не показывает. */
  acceptedAtCheckout: boolean;
  /** Актуальная редакция документа. */
  currentVersion: string;
  /** Версия, на которую пользователь согласился. null — согласия нет. */
  acceptedVersion: string | null;
  acceptedAt: string | null;
  /** true, если отметка стоит на устаревшей редакции. */
  needsRenewal: boolean;
  /**
   * Что значит устаревшая отметка: `notify` — только уведомить о новой
   * редакции, `reconsent` — попросить подтвердить согласие (см.
   * `LegalDocument.updatePolicy`). Ни то, ни другое не закрывает доступ.
   */
  updatePolicy: LegalDocument['updatePolicy'];
}

@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly widgets: WidgetsService,
    private readonly rooms: RoomEviction,
    private readonly platformTokens: PlatformTokenService,
    private readonly bus: RealtimeBus,
    private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Состояние согласий пользователя.
   *
   * Сравнение с актуальной версией здесь не косметика: отметка на редакции
   * полугодовой давности — это не отметка на новой, и интерфейс обязан это
   * показывать, а не молча считать галочку проставленной. Что делать с
   * расхождением — уведомить или просить подтверждения — говорит
   * `updatePolicy`; закрывать доступ оно не может ни в одном случае.
   */
  async listConsents(userId: string): Promise<ConsentView[]> {
    const rows = await this.prisma.consent.findMany({
      where: { userId, revokedAt: null },
      orderBy: { grantedAt: 'desc' },
    });

    const latestByDocument = new Map<ConsentDocument, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latestByDocument.has(row.document)) {
        latestByDocument.set(row.document, row);
      }
    }

    return publishedDocuments().map((document) => {
      const accepted = latestByDocument.get(document.document);
      return {
        document: document.document,
        title: document.title,
        path: document.path,
        required: document.requiredOnRegister,
        acceptedAtCheckout: document.acceptedAtCheckout,
        currentVersion: document.version,
        acceptedVersion: accepted?.documentVersion ?? null,
        acceptedAt: accepted?.grantedAt.toISOString() ?? null,
        needsRenewal: accepted ? accepted.documentVersion !== document.version : false,
        updatePolicy: document.updatePolicy,
      };
    });
  }

  /**
   * «Ознакомлен с новой редакцией» — одной кнопкой по всем изменившимся
   * документам.
   *
   * Зачем запись вообще, если соглашение принято регистрацией: уведомление
   * должно быть доказуемым. Иначе спор «меня не предупредили» опирается на то,
   * что баннер когда-то показывался, а это ничем не подтверждается. Отметка
   * пишется тем же журналом согласий — он и есть источник правды о том, какую
   * редакцию человек видел.
   *
   * Документы, принимаемые при оплате (`acceptedAtCheckout`), пропускаются:
   * согласие на списания даётся выбором тарифа и суммы, а не кнопкой
   * «понятно» в баннере.
   *
   * @returns сколько отметок поставлено.
   */
  async acknowledgeUpdates(userId: string, context: AuditContext = {}): Promise<number> {
    const outdated = (await this.listConsents(userId)).filter(
      (consent) => consent.needsRenewal && !consent.acceptedAtCheckout,
    );

    for (const consent of outdated) {
      await this.grant(userId, consent.document, context);
    }
    return outdated.length;
  }

  async grant(
    userId: string,
    document: ConsentDocument,
    context: AuditContext = {},
  ): Promise<void> {
    const definition = LEGAL_DOCUMENTS[document];
    if (!definition.published) {
      throw new BadRequestException('Такого документа нет.');
    }
    if (definition.acceptedAtCheckout) {
      throw new BadRequestException('Это согласие даётся при оплате тарифа.');
    }
    await this.prisma.consent.create({
      data: {
        userId,
        document,
        documentVersion: definition.version,
        ipHash: context.ipHash ?? null,
        userAgent: context.userAgent ?? null,
      },
    });
    await this.audit.record('consent.granted', userId, {
      ...context,
      metadata: { document, version: definition.version },
    });
  }

  /** Обязательные для регистрации согласия отзываются только удалением аккаунта. */
  async revoke(
    userId: string,
    document: ConsentDocument,
    context: AuditContext = {},
  ): Promise<void> {
    if (REQUIRED_ON_REGISTER.includes(document)) {
      throw new BadRequestException(
        'Это согласие необходимо для работы сервиса. Отозвать его можно, удалив учётную запись.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.consent.updateMany({
        where: { userId, document, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Отозванное согласие на списания — это выключенное автопродление, а не
      // пометка в журнале: иначе воркер списал бы деньги у человека, который
      // только что от этого отказался. Доступ доживает оплаченный период.
      if (document === 'SUBSCRIPTION_OFFER') {
        await tx.subscription.updateMany({ where: { userId }, data: { autoRenew: false } });
      }
    });
    await this.audit.record('consent.revoked', userId, { ...context, metadata: { document } });
  }

  /**
   * Выгрузка данных субъекта. Секретов в выгрузке нет: хэши паролей и токенов,
   * шифротексты OAuth-токенов и TOTP-секрет сюда не попадают — это не данные
   * пользователя, а учётные данные доступа.
   */
  async exportData(userId: string, context: AuditContext = {}): Promise<Record<string, unknown>> {
    const [
      user,
      consents,
      widgets,
      events,
      sources,
      channels,
      snapshots,
      rooms,
      subscription,
      payments,
      devices,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          isTotpEnabled: true,
          language: true,
          createdAt: true,
        },
      }),
      this.prisma.consent.findMany({ where: { userId } }),
      this.prisma.widget.findMany({ where: { userId } }),
      this.prisma.alertEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.donationSource.findMany({
        where: { userId },
        select: {
          provider: true,
          isEnabled: true,
          disabledReason: true,
          externalAccountId: true,
          accountName: true,
          lastEventAt: true,
        },
      }),
      this.prisma.channel.findMany({ where: { userId } }),
      // Снимки метрик — тоже данные субъекта: это поминутная история его
      // эфиров. Отдаём их вместе с каналами, иначе выгрузка формально неполная,
      // а по сути стример не может забрать собственную аналитику при уходе.
      this.prisma.analyticsSnapshot.findMany({
        where: { channel: { userId } },
        orderBy: { capturedAt: 'desc' },
      }),
      // Комнаты и приглашения — без хэшей токенов: это учётные данные доступа, а
      // не данные субъекта. Согласия гостей сюда тоже не входят — это данные
      // третьих лиц, а не стримера, как и отпечатки их запросов.
      this.prisma.room.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          createdAt: true,
          invites: {
            select: { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true },
          },
        },
      }),
      // Подписка — без шифротекста способа оплаты: по нему списывают деньги,
      // это учётные данные доступа к кошельку, а не сведения о человеке.
      this.prisma.subscription.findUnique({
        where: { userId },
        select: {
          period: true,
          currentPeriodEnd: true,
          autoRenew: true,
          renewalAmountMinor: true,
          renewalCurrency: true,
          paymentMethodTitle: true,
          createdAt: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          kind: true,
          period: true,
          amountMinor: true,
          currency: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
          paidAt: true,
          refundedAmountMinor: true,
          refundedAt: true,
        },
      }),
      // Браузеры, из которых входили, — без хэша метки: по нему узнаётся
      // браузер, это учётные данные, как хэш сессии.
      this.prisma.knownDevice.findMany({
        where: { userId },
        orderBy: { lastSeenAt: 'desc' },
        select: { userAgent: true, createdAt: true, lastSeenAt: true },
      }),
    ]);

    await this.audit.record('privacy.data.exported', userId, context);

    return {
      exportedAt: new Date().toISOString(),
      format: 'streamkit-export-v1',
      user,
      consents,
      widgets,
      events,
      donationSources: sources,
      channels,
      rooms,
      subscription,
      payments,
      knownDevices: devices,
      // BigInt не сериализуется в JSON — приводим к строке, а не к number:
      // просмотры крупного канала в number ещё влезают, но правило «не терять
      // точность молча» дешевле соблюдать везде, чем помнить, где можно.
      analyticsSnapshots: snapshots.map((snapshot) => ({
        ...snapshot,
        totalViews: snapshot.totalViews === null ? null : snapshot.totalViews.toString(),
      })),
    };
  }

  /**
   * Удаление по запросу владельца: пароль, затем обезличивание.
   *
   * 400, а не 401, на неверный пароль: 401 клиент понимает как протухший
   * access-токен и уходит его обновлять, а человек просто ошибся в пароле.
   */
  async deleteAccount(userId: string, password: string, context: AuditContext = {}): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new BadRequestException('Пароль указан неверно');
    }
    await this.anonymize(userId, context);
  }

  /**
   * Удаление учётной записи через обезличивание.
   *
   * Строку не удаляем физически: на неё ссылается история событий, а суммы и даты
   * донатов нужны нам самим для бухгалтерии и разбора споров. Вместо этого
   * стираются идентифицирующие данные, гасятся сессии и обрываются интеграции.
   * Что именно остаётся и на какой срок — описано в политике обработки ПДн.
   */
  async anonymize(userId: string, context: AuditContext = {}): Promise<void> {
    const placeholder = `deleted-${randomUUID()}@streamkit.invalid`;
    // Что оборвать после транзакции: внутри неё ссылки гаснут и комнаты
    // удаляются только в БД, а открытые сцены OBS и созвоны живут отдельно.
    const overlayTokenIds = await this.widgets.activeOverlayTokenIds(userId);
    const roomIds = (
      await this.prisma.room.findMany({ where: { userId }, select: { id: true } })
    ).map((room) => room.id);

    // Доступ к площадкам отзывается у них самих, пока токены ещё у нас: после
    // транзакции отзывать было бы нечем, а разрешение приложения осталось бы в
    // аккаунте Google, Twitch или Kick человека, который удалил аккаунт у нас.
    for (const platform of ['youtube', 'twitch', 'kick'] as const) {
      await this.platformTokens.revoke(userId, platform);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: placeholder,
          displayName: 'Удалённый пользователь',
          passwordHash: randomUUID(),
          status: 'ANONYMIZED',
          isTotpEnabled: false,
          totpSecretEncrypted: null,
          anonymizedAt: new Date(),
          // Роль обезличенному не нужна: сотрудник, ушедший так, не должен
          // сохранить вход в админку.
          role: 'USER',
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Браузеры, из которых входили, нужны только для писем о входе с нового
      // устройства — а писать больше некому.
      await tx.knownDevice.deleteMany({ where: { userId } });

      // Виджеты удаляются вместе со ссылками OBS и состоянием: оверлеи должны
      // перестать работать немедленно, а в настройках лежит не только
      // оформление — канал Twitch самого стримера и ники зрителей из списка
      // скрытых. Хранить их после удаления аккаунта не на каком основании.
      await tx.widget.deleteMany({ where: { userId } });

      // Доступы к внешним сервисам хранить больше не на каком основании.
      await tx.integrationCredential.deleteMany({ where: { userId } });

      // Источники донатов обязаны замолчать вместе с аккаунтом — и исчезнуть:
      // идентификатор и имя аккаунта у сервиса тоже данные человека.
      //
      // Секрет вебхука уже настроен на стороне чужого сервиса, и пока строка
      // жива и включена, каждый следующий донат проходит проверку подписи и
      // создаёт AlertEvent с именем и сообщением донатера. Это ПДн третьих
      // лиц, записанные ПОСЛЕ отзыва оснований на обработку: обезличивание
      // ниже их уже не застанет, оно выполнилось раньше.
      await tx.donationSource.deleteMany({ where: { userId } });

      // Каналы площадок: без учётных данных они бесполезны, а строка мешала бы
      // подключить тот же канал заново.
      await tx.channel.deleteMany({ where: { userId } });

      // Комнаты удаляются вместе с приглашениями и согласиями гостей: ссылки
      // обязаны перестать открывать комнату немедленно, а хранить согласия на
      // участие в эфире, которого больше не будет, не на каком основании.
      await tx.room.deleteMany({ where: { userId } });

      // Способ оплаты — доступ к деньгам человека, который ушёл. Платежи
      // остаются: это учёт выручки, а не данные для работы сервиса.
      await tx.subscription.updateMany({
        where: { userId },
        data: { autoRenew: false, paymentMethodEncrypted: null, paymentMethodTitle: null },
      });
      await tx.consent.updateMany({
        where: { userId, document: 'SUBSCRIPTION_OFFER', revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Имена и сообщения донатеров — это ПДн третьих лиц, привязанные к аккаунту.
      await tx.alertEvent.updateMany({
        where: { userId },
        // Ссылка на голосовой донат — такие же данные донатера, как имя и
        // текст: обезличивание её удаляет, иначе запись оставалась бы
        // доступной по сохранённому адресу.
        data: { username: 'Аноним', message: '', audioUrl: null },
      });
    });

    // Выданные access-токены живут до своего срока, а refresh-токены погашены
    // выше. Без отметки вторая вкладка или устройство ещё четверть часа
    // работали бы от имени удалённого аккаунта: подключили бы источник донатов
    // заново и начали собирать данные донатеров, удалить которые уже некому.
    await markUserBlocked(
      this.redis,
      userId,
      Math.max(this.config.accessTtlSeconds, ADMIN_ACCESS_TTL_SECONDS),
    );
    // Сообщение шины то же, что у блокировки: оба значат «сокеты дашборда
    // этого человека закрыть».
    await this.bus.publish({ kind: 'user-suspended', userId });
    await this.audit.record('privacy.account.anonymized', userId, context);

    await this.widgets.disconnectOverlays(userId, overlayTokenIds, 'token-revoked');
    await this.rooms.emptyRooms(roomIds);
  }
}
