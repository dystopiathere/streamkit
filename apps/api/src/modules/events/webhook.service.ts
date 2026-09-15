import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { type WebhookAlertPayload, webhookAlertPayloadSchema } from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsService, type IngestResult } from './events.service';

export const WEBHOOK_TIMESTAMP_HEADER = 'x-streamkit-timestamp';
export const WEBHOOK_SIGNATURE_HEADER = 'x-streamkit-signature';

/**
 * Допустимое расхождение часов между отправителем и нами. Пять минут — компромисс:
 * меньше ломается на плохо синхронизированных серверах, больше даёт слишком широкое
 * окно для повтора перехваченного запроса.
 */
const MAX_CLOCK_SKEW_SECONDS = 300;

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Проверка подписи и приём события.
   *
   * Подписывается строка `${timestamp}.${rawBody}` — именно сырое тело, а не
   * результат JSON.parse: пересериализация меняет порядок ключей и пробелы,
   * и подпись перестаёт сходиться у половины клиентов.
   *
   * Любая неудача отвечает одинаковым 401 без подробностей: отправителю не нужно
   * знать, что именно не сошлось, а атакующему — тем более.
   */
  async handle(
    sourceId: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
    context: AuditContext = {},
  ): Promise<IngestResult> {
    const signature = singleHeader(headers[WEBHOOK_SIGNATURE_HEADER]);
    const timestamp = singleHeader(headers[WEBHOOK_TIMESTAMP_HEADER]);

    if (!rawBody || !signature || !timestamp) {
      throw await this.invalid(sourceId, null, context, 'missing-headers');
    }

    const source = await this.prisma.donationSource.findFirst({
      where: { id: sourceId, provider: 'WEBHOOK', isEnabled: true },
    });

    if (!source?.webhookSecretEncrypted) {
      throw await this.invalid(sourceId, null, context, 'unknown-source');
    }

    await this.assertFreshTimestamp(timestamp, sourceId, source.userId, context);

    const body = rawBody.toString('utf8');
    const secret = this.crypto.decrypt(source.webhookSecretEncrypted);
    const expected = this.crypto.hmacHex(secret, `${timestamp}.${body}`);

    if (!this.crypto.safeCompare(expected, signature)) {
      throw await this.invalid(sourceId, source.userId, context, 'bad-signature');
    }

    // Отдельной защиты от повтора подписанного запроса нет намеренно. Повтор
    // несёт тот же `externalId`, и его отбрасывает дедупликация — Redis и
    // уникальный индекс в БД, — отвечая «дубль», а не ошибкой. Раньше подпись
    // запоминалась в Redis ДО записи события, и честный повтор отправителя после
    // нашего же сбоя базы получал 401: донат терялся, а интегратор видел отказ в
    // подписи и шёл проверять секрет. Окно по метке времени остаётся как было.
    const payload = parsePayload(body);

    return this.events.ingest({
      userId: source.userId,
      type: payload.type,
      provider: 'webhook',
      externalId: payload.externalId,
      username: payload.username,
      message: payload.message,
      amount: payload.amount,
      isTest: false,
      occurredAt: payload.occurredAt,
    });
  }

  /**
   * Выпуск нового секрета вебхука. Старый перестаёт работать сразу — это и есть
   * механизм отзыва при подозрении на утечку.
   */
  async rotateSecret(userId: string): Promise<{ sourceId: string; secret: string }> {
    const secret = this.crypto.generateToken(32);
    const encrypted = this.crypto.encrypt(secret);

    const source = await this.prisma.donationSource.upsert({
      where: { userId_provider: { userId, provider: 'WEBHOOK' } },
      create: { userId, provider: 'WEBHOOK', webhookSecretEncrypted: encrypted },
      update: { webhookSecretEncrypted: encrypted, isEnabled: true },
      select: { id: true },
    });

    return { sourceId: source.id, secret };
  }

  private async assertFreshTimestamp(
    timestamp: string,
    sourceId: string,
    userId: string,
    context: AuditContext,
  ): Promise<void> {
    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt)) {
      throw await this.invalid(sourceId, userId, context, 'bad-timestamp');
    }

    const skewSeconds = Math.abs(Date.now() / 1000 - sentAt);
    if (skewSeconds > MAX_CLOCK_SKEW_SECONDS) {
      await this.audit.record('webhook.replay_rejected', userId, {
        ...context,
        metadata: { sourceId, skewSeconds: Math.round(skewSeconds) },
      });
      throw new UnauthorizedException('Подпись недействительна');
    }
  }

  /**
   * Пишет причину отказа в аудит и возвращает исключение, которое вызывающий код
   * бросает сам (`throw await this.invalid(...)`). Возврат, а не бросок изнутри,
   * нужен чтобы TypeScript видел прерывание потока и корректно сужал типы.
   */
  private async invalid(
    sourceId: string,
    userId: string | null,
    context: AuditContext,
    reason: string,
  ): Promise<UnauthorizedException> {
    await this.audit.record('webhook.signature.invalid', userId, {
      ...context,
      metadata: { sourceId, reason },
    });
    return new UnauthorizedException('Подпись недействительна');
  }
}

/**
 * Разбор тела ПОСЛЕ проверки подписи.
 *
 * Отдельная функция и 400 вместо 401 здесь осознанны: подпись сошлась, значит
 * отправитель свой, и ему нужно знать, что именно в теле не так. А главное —
 * это не 500: ZodError и SyntaxError, брошенные наружу, Nest превращает в
 * «внутреннюю ошибку сервера», и добросовестный интегратор уходит в очередь
 * ретраев с тем же битым телом вместо того, чтобы починить формат.
 */
function parsePayload(body: string): WebhookAlertPayload {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new BadRequestException({ message: 'Тело запроса не является JSON' });
  }

  const result = webhookAlertPayloadSchema.safeParse(json);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Ошибка валидации',
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  return result.data;
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
