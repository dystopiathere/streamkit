import { verify } from 'node:crypto';
import type { ChatMessage, ChatPart, IncomingAlertEvent } from '@streamkit/contracts';

/** Заголовки доставки вебхука Kick (`docs.kick.com/events/webhook-security`). */
export interface KickWebhookHeaders {
  messageId: string;
  timestamp: string;
  signature: string;
  eventType: string;
  eventVersion: string;
}

const ANONYMOUS = 'Аноним';

/** Пользователь в теле события: у анонимного дарителя поля пустые. */
interface KickEventUser {
  is_anonymous?: boolean;
  user_id?: number | null;
  username?: string | null;
  channel_slug?: string | null;
  identity?: {
    username_color?: string | null;
    badges?: Array<{ type?: string | null }> | null;
  } | null;
}

/** Тело любого события Kick: у всех есть канал, остальное зависит от типа. */
export interface KickEventPayload {
  broadcaster?: KickEventUser;
  [field: string]: unknown;
}

/**
 * Заголовки из запроса. Без любого из них вебхук не проверить — это не наш
 * отправитель, а не «событие без типа».
 */
export function readKickHeaders(
  headers: Record<string, string | string[] | undefined>,
): KickWebhookHeaders | null {
  const pick = (name: string): string | null => {
    const value = headers[name];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const messageId = pick('kick-event-message-id');
  const timestamp = pick('kick-event-message-timestamp');
  const signature = pick('kick-event-signature');
  const eventType = pick('kick-event-type');
  const eventVersion = pick('kick-event-version');
  if (!messageId || !timestamp || !signature || !eventType || !eventVersion) return null;
  return { messageId, timestamp, signature, eventType, eventVersion };
}

/**
 * Подпись вебхука: RSA PKCS#1 v1.5 над SHA-256 от `id.timestamp.тело`.
 *
 * Тело — СЫРОЕ, байт в байт как пришло: пересобранный из разобранного JSON
 * текст отличается пробелами и порядком ключей, и подпись не сошлась бы ни
 * разу. Битая подпись или ключ — `false`, а не исключение: снаружи это один и
 * тот же ответ «не от Kick».
 */
export function verifyKickSignature(
  publicKey: string,
  headers: Pick<KickWebhookHeaders, 'messageId' | 'timestamp' | 'signature'>,
  rawBody: Buffer,
): boolean {
  try {
    const signed = Buffer.concat([
      Buffer.from(`${headers.messageId}.${headers.timestamp}.`, 'utf8'),
      rawBody,
    ]);
    return verify('sha256', signed, publicKey, Buffer.from(headers.signature, 'base64'));
  } catch {
    return false;
  }
}

/** Идентификатор канала события — строкой, как `Channel.externalId`. */
export function broadcasterIdOf(payload: KickEventPayload): string | null {
  const id = payload.broadcaster?.user_id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

function author(user: unknown): string {
  const value = (user ?? {}) as KickEventUser;
  if (value.is_anonymous === true) return ANONYMOUS;
  return text(value.username).trim() || ANONYMOUS;
}

/**
 * Событие Kick → оповещение. null — событие не оповещение (эфир, чат,
 * модерация) или не то, о котором стоит оповещать.
 *
 * Ключ дедупликации — `Kick-Event-Message-Id`: Kick повторяет доставку, пока
 * мы не ответим успехом. У награды — id самого обмена: Kick шлёт событие и на
 * взятие, и на одобрение из очереди, а алерт о награде нужен один.
 */
export function normalizeKickEvent(
  headers: Pick<KickWebhookHeaders, 'messageId' | 'eventType'>,
  payload: KickEventPayload,
  userId: string,
): IncomingAlertEvent | null {
  const base = {
    userId,
    provider: 'kick' as const,
    externalId: headers.messageId,
    amount: null,
    audioUrl: null,
    isTest: false,
  };
  const build = (
    type: IncomingAlertEvent['type'],
    username: string,
    extra: { message?: string; count?: number | null; externalId?: string; at?: unknown } = {},
  ): IncomingAlertEvent => ({
    ...base,
    type,
    externalId: extra.externalId ?? base.externalId,
    username: username.slice(0, 64),
    message: (extra.message ?? '').slice(0, 500),
    count: extra.count ?? null,
    occurredAt: instant(extra.at ?? payload.created_at),
  });

  switch (headers.eventType) {
    case 'channel.followed':
      return build('follow', author(payload.follower));

    // Число месяцев — `duration`: у новой подписки это купленный срок, у
    // продления — сколько месяцев подряд, как `cumulative_months` у Twitch.
    case 'channel.subscription.new':
      return build('subscription', author(payload.subscriber));

    case 'channel.subscription.renewal':
      return build('resubscription', author(payload.subscriber), {
        count: count(payload.duration),
      });

    // Подарок — одним алертом дарителя: у Kick получатели приходят списком в
    // том же событии, отдельного события на каждого нет.
    case 'channel.subscription.gifts': {
      const giftees = Array.isArray(payload.giftees) ? payload.giftees.length : null;
      return build('gift', author(payload.gifter), { count: giftees });
    }

    case 'channel.reward.redemption.updated': {
      // Отклонённый стримером обмен — не повод для алерта в кадре.
      if (payload.status === 'rejected') return null;
      const redemptionId = text(payload.id);
      const reward = text((payload.reward as { title?: unknown } | undefined)?.title);
      const input = text(payload.user_input).trim();
      return build('reward', author(payload.redeemer), {
        message: input ? `${reward}: ${input}` : reward,
        externalId: redemptionId ? `redemption:${redemptionId}` : undefined,
        at: payload.redeemed_at,
      });
    }

    // KICKs — сумма подарка в валюте Kick, не деньги: в `count`, как биты, а
    // не в `amount`. Название подарка («Rage Quit») в кадр не идёт — это
    // название анимации Kick, а не слова зрителя.
    case 'kicks.gifted': {
      const gift = (payload.gift ?? {}) as { amount?: unknown; message?: unknown };
      return build('kicks', author(payload.sender), {
        count: count(gift.amount) || null,
        message: text(gift.message),
      });
    }

    default:
      return null;
  }
}

/** Начался или кончился эфир — сигнал сбору метрик, а не оповещение. */
export function liveStateOf(eventType: string, payload: KickEventPayload): boolean | null {
  if (eventType !== 'livestream.status.updated') return null;
  return typeof payload.is_live === 'boolean' ? payload.is_live : null;
}

/** `[emote:37226:KEKW]` — так Kick вписывает эмоут прямо в текст сообщения. */
const EMOTE_PATTERN = /\[emote:\d+:([^\]\s]{1,64})\]/g;

/**
 * Текст сообщения Kick → части.
 *
 * Эмоут становится своим названием, а не картинкой: адрес картинок эмоутов в
 * публичной документации Kick не описан, а строить его по догадке значит
 * однажды показать в кадре пустые рамки. Название читается и так.
 */
export function kickChatParts(content: string): ChatPart[] {
  const value = content.replace(EMOTE_PATTERN, (_match, name: string) => name).slice(0, 500);
  return value ? [{ kind: 'text', value }] : [];
}

/** Значки Kick, которые совпадают по смыслу со значками виджета. */
const BADGES: Record<string, ChatMessage['badges'][number]> = {
  broadcaster: 'broadcaster',
  moderator: 'moderator',
  vip: 'vip',
  subscriber: 'subscriber',
  founder: 'founder',
  staff: 'staff',
  verified: 'verified',
};

/**
 * Событие `chat.message.sent` → сообщение чата. null — не хватает полей, без
 * которых строку не показать и не отфильтровать (канал, автор, id).
 *
 * `login` автора — его `user_id`: имя Kick можно сменить, а список скрытых и
 * ключи строятся по постоянному идентификатору.
 */
export function toKickChatMessage(payload: KickEventPayload): ChatMessage | null {
  const channel = broadcasterIdOf(payload);
  const sender = (payload.sender ?? {}) as KickEventUser;
  const senderId = sender.user_id;
  const id = text(payload.message_id);
  const username = text(sender.username).trim();
  if (!channel || !id || !username || typeof senderId !== 'number' || senderId <= 0) return null;

  const color = text(sender.identity?.username_color);
  const badges = [
    ...new Set(
      (sender.identity?.badges ?? [])
        .map((badge) => BADGES[text(badge?.type)])
        .filter((badge): badge is ChatMessage['badges'][number] => badge !== undefined),
    ),
  ].slice(0, 8);

  return {
    platform: 'kick',
    id,
    channel,
    login: String(senderId),
    username: username.slice(0, 100),
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
    badges,
    parts: kickChatParts(text(payload.content)),
    sentAt: instant(payload.created_at) ?? new Date().toISOString(),
  };
}

function instant(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
