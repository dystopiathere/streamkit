import { Inject, Injectable, Logger } from '@nestjs/common';
import { mailLanguageSchema } from '@streamkit/contracts';
import { MAILER, type Mailer } from '../../common/mail/mailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { type LegalDocument, publishedDocuments } from './legal-documents';
import { legalUpdateMessage } from './legal-update-mail';

/** Писем за такт. Postbox ограничивает частоту, а срочности в этих письмах нет. */
const BATCH_USERS = 100;

/**
 * Письма о новых редакциях документов (соглашение, 11.2; политика, 13.2).
 *
 * Кому: тем, чья действующая отметка стоит на прежней редакции документа, — то
 * же условие, по которому дашборд показывает баннер. Кто уже отметил новую
 * редакцию в баннере, письма не получает; кто отозвал согласие (cookie) —
 * тоже: ему нечего подтверждать.
 *
 * Одно письмо на человека за такт, со всеми изменившимися документами.
 * Отметка `LegalUpdateNotice` ставится ДО отправки и снимается при сбое: так
 * повторный такт после сбоя почты дошлёт письмо, а после сбоя процесса
 * посреди рассылки — не пришлёт второе.
 */
@Injectable()
export class LegalUpdateNoticesService {
  private readonly logger = new Logger(LegalUpdateNoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /** @returns сколько писем отправлено. */
  async sendPending(): Promise<number> {
    if (!this.mailer.configured) return 0;

    const pending = new Map<string, LegalDocument[]>();
    for (const document of publishedDocuments()) {
      const users = await this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          AND: [
            {
              consents: {
                some: {
                  document: document.document,
                  revokedAt: null,
                  documentVersion: { not: document.version },
                },
              },
            },
            {
              consents: {
                none: {
                  document: document.document,
                  revokedAt: null,
                  documentVersion: document.version,
                },
              },
            },
          ],
          legalNotices: { none: { document: document.document, version: document.version } },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH_USERS,
      });
      for (const { id } of users) {
        pending.set(id, [...(pending.get(id) ?? []), document]);
      }
    }

    let sent = 0;
    for (const [userId, documents] of [...pending].slice(0, BATCH_USERS)) {
      if (await this.notify(userId, documents)) sent += 1;
    }
    return sent;
  }

  private async notify(userId: string, documents: LegalDocument[]): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true, language: true },
    });
    if (!user) return false;

    const marks = documents.map((document) => ({
      userId,
      document: document.document,
      version: document.version,
    }));
    await this.prisma.legalUpdateNotice.createMany({ data: marks, skipDuplicates: true });

    try {
      await this.mailer.send(
        legalUpdateMessage({
          email: user.email,
          displayName: user.displayName,
          language: mailLanguageSchema.catch('ru').parse(user.language),
          documents,
          webBaseUrl: this.config.webBaseUrl,
        }),
      );
      return true;
    } catch (error) {
      this.logger.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Письмо о новой редакции документов не отправлено',
      );
      await this.prisma.legalUpdateNotice.deleteMany({
        where: { OR: marks },
      });
      return false;
    }
  }
}
