import { Injectable, Logger } from '@nestjs/common';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { EventsService } from '../events/events.service';
import {
  broadcasterIdOf,
  type KickEventPayload,
  liveStateOf,
  normalizeKickEvent,
  readKickHeaders,
  toKickChatMessage,
  verifyKickSignature,
} from './kick-events';
import { KICK_CHAT_EVENT } from './kick.provider';

/**
 * Сообщение чата старше этого в кадр не идёт. Kick повторяет доставку, пока не
 * получит успех, и после сбоя у нас пачка вчерашних строк выехала бы поверх
 * эфира. Оповещениям возраст не мешает: их дубли отбрасывает дедупликация.
 */
export const KICK_CHAT_MAX_AGE_MS = 60_000;

export type KickWebhookResult = 'invalid' | 'accepted' | 'ignored';

/**
 * Приём вебхуков Kick: подпись, затем разбор по типу события.
 *
 * Kick присылает события ВСЕХ каналов, подписанных приложением, на один адрес.
 * Чей это канал, решает `broadcaster.user_id` и таблица подключённых каналов;
 * выключенный канал (тариф с одной площадкой) событий не получает — тот же
 * гейт `isEnabled`, что у опроса, коннекторов и чата.
 */
@Injectable()
export class KickWebhookService {
  private readonly logger = new Logger(KickWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly bus: RealtimeBus,
    private readonly config: AppConfig,
  ) {}

  /**
   * @returns `invalid` — подпись не сошлась или заголовков нет; `ignored` —
   *          событие не наше или не нужное; `accepted` — разобрано.
   * @throws при сбое БД, Redis или шины: вызывающий отвечает 5xx, и Kick
   *         повторит доставку. На свой сбой успехом не отвечаем.
   */
  async handle(
    rawBody: Buffer | undefined,
    rawHeaders: Record<string, string | string[] | undefined>,
  ): Promise<KickWebhookResult> {
    const headers = readKickHeaders(rawHeaders);
    if (!rawBody || !headers) return 'invalid';
    if (!verifyKickSignature(this.config.kickEndpoints.webhookPublicKey, headers, rawBody)) {
      return 'invalid';
    }

    let payload: KickEventPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as KickEventPayload;
    } catch {
      // Подписанный Kick, но не JSON: повтор не поможет, ошибка не наша.
      this.logger.warn({ type: headers.eventType }, 'Вебхук Kick с неразборчивым телом');
      return 'ignored';
    }
    if (headers.eventVersion !== '1') {
      // Новая версия меняет форму тела: разбирать её по старой — значит
      // однажды показать в кадре пустой ник вместо ошибки в журнале.
      this.logger.warn(
        { type: headers.eventType, version: headers.eventVersion },
        'Незнакомая версия события Kick',
      );
      return 'ignored';
    }

    const broadcasterId = broadcasterIdOf(payload);
    if (!broadcasterId) return 'ignored';

    if (headers.eventType === KICK_CHAT_EVENT) {
      return this.chat(payload, headers.timestamp);
    }

    const owners = await this.prisma.channel.findMany({
      where: { platform: 'KICK', externalId: broadcasterId, isEnabled: true },
      select: { userId: true },
    });
    if (owners.length === 0) return 'ignored';

    const isLive = liveStateOf(headers.eventType, payload);
    if (isLive !== null) {
      for (const { userId } of owners) {
        await this.bus.publish({ kind: 'channel-live', userId, platform: 'kick', isLive });
      }
      return 'accepted';
    }

    let accepted = false;
    for (const { userId } of owners) {
      const event = normalizeKickEvent(headers, payload, userId);
      if (!event) continue;
      await this.events.ingest(event);
      accepted = true;
    }
    return accepted ? 'accepted' : 'ignored';
  }

  /**
   * Чат — в шину, без запроса к БД: сообщений сотни в минуту, а читается ли
   * канал сейчас, знает источник чата в воркере (`KickChatSource`), он и
   * отбросит строки канала, который никто не показывает.
   */
  private async chat(payload: KickEventPayload, timestamp: string): Promise<KickWebhookResult> {
    const sentAt = Date.parse(timestamp);
    if (!Number.isFinite(sentAt) || Date.now() - sentAt > KICK_CHAT_MAX_AGE_MS) return 'ignored';

    const message = toKickChatMessage(payload);
    if (!message) return 'ignored';
    await this.bus.publish({ kind: 'kick-chat', message });
    return 'accepted';
  }
}
