import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { ConsentDocument } from '@prisma/client';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LEGAL_DOCUMENTS, REQUIRED_ON_REGISTER } from './legal-documents';

export interface ConsentView {
  document: ConsentDocument;
  title: string;
  path: string;
  required: boolean;
  /** Актуальная редакция документа. */
  currentVersion: string;
  /** Версия, на которую пользователь согласился. null — согласия нет. */
  acceptedVersion: string | null;
  acceptedAt: string | null;
  /** true, если согласие дано на устаревшую редакцию и его нужно подтвердить заново. */
  needsRenewal: boolean;
}

@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Состояние согласий пользователя.
   *
   * Сравнение с актуальной версией здесь не косметика: согласие на редакцию
   * полугодовой давности не является согласием на новую, и интерфейс обязан это
   * показывать, а не молча считать галочку проставленной.
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

    return Object.values(LEGAL_DOCUMENTS).map((document) => {
      const accepted = latestByDocument.get(document.document);
      return {
        document: document.document,
        title: document.title,
        path: document.path,
        required: document.requiredOnRegister,
        currentVersion: document.version,
        acceptedVersion: accepted?.documentVersion ?? null,
        acceptedAt: accepted?.grantedAt.toISOString() ?? null,
        needsRenewal: accepted ? accepted.documentVersion !== document.version : false,
      };
    });
  }

  async grant(
    userId: string,
    document: ConsentDocument,
    context: AuditContext = {},
  ): Promise<void> {
    const definition = LEGAL_DOCUMENTS[document];
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

    await this.prisma.consent.updateMany({
      where: { userId, document, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record('consent.revoked', userId, { ...context, metadata: { document } });
  }

  /**
   * Выгрузка данных субъекта. Секретов в выгрузке нет: хэши паролей и токенов,
   * шифротексты OAuth-токенов и TOTP-секрет сюда не попадают — это не данные
   * пользователя, а учётные данные доступа.
   */
  async exportData(userId: string, context: AuditContext = {}): Promise<Record<string, unknown>> {
    const [user, consents, widgets, events, sources, channels, snapshots, rooms] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            displayName: true,
            status: true,
            isTotpEnabled: true,
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
   * Удаление учётной записи через обезличивание.
   *
   * Строку не удаляем физически: на неё ссылается история событий, а суммы и даты
   * донатов нужны нам самим для бухгалтерии и разбора споров. Вместо этого
   * стираются идентифицирующие данные, гасятся сессии и обрываются интеграции.
   * Что именно остаётся и на какой срок — описано в политике обработки ПДн.
   */
  async anonymize(userId: string, context: AuditContext = {}): Promise<void> {
    const placeholder = `deleted-${randomUUID()}@streamkit.invalid`;

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
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Оверлеи должны перестать работать немедленно.
      await tx.overlayToken.updateMany({
        where: { widget: { userId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Доступы к внешним сервисам хранить больше не на каком основании.
      await tx.integrationCredential.deleteMany({ where: { userId } });

      // Источники донатов обязаны замолчать вместе с аккаунтом.
      //
      // Секрет вебхука уже настроен на стороне чужого сервиса, и пока строка
      // жива и включена, каждый следующий донат проходит проверку подписи и
      // создаёт AlertEvent с именем и сообщением донатера. Это ПДн третьих
      // лиц, записанные ПОСЛЕ отзыва оснований на обработку: обезличивание
      // выше их уже не застанет, оно выполнилось раньше.
      await tx.donationSource.updateMany({
        where: { userId },
        data: { isEnabled: false, webhookSecretEncrypted: null },
      });

      // Каналы площадок: без учётных данных они бесполезны, а строка мешала бы
      // подключить тот же канал заново.
      await tx.channel.deleteMany({ where: { userId } });

      // Комнаты удаляются вместе с приглашениями и согласиями гостей: ссылки
      // обязаны перестать открывать комнату немедленно, а хранить согласия на
      // участие в эфире, которого больше не будет, не на каком основании.
      await tx.room.deleteMany({ where: { userId } });

      // Имена и сообщения донатеров — это ПДн третьих лиц, привязанные к аккаунту.
      await tx.alertEvent.updateMany({
        where: { userId },
        data: { username: 'Аноним', message: '' },
      });
    });

    await this.audit.record('privacy.account.anonymized', userId, context);
  }
}
