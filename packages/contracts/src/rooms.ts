import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common.js';

/**
 * Приватные комнаты: стример зовёт гостей, оверлей выводит их в OBS.
 *
 * Медиа идёт через свой LiveKit (SFU), а не через API: сервер платформы только
 * выдаёт короткие токены доступа и проверяет, кому их можно выдать. Почему так —
 * docs/adr/0010.
 */

/**
 * Сколько гостей одновременно в одной комнате.
 *
 * Не технический предел SFU, а продуктовый: плитка девятого гостя в кадре уже
 * размером с марку, а каждый гость — это ещё полтора-два мегабита исходящего
 * трафика с сервера на каждого подписчика.
 */
export const MAX_GUESTS_PER_ROOM = 8;

/**
 * Срок жизни токена LiveKit — это ОКНО ВХОДА, а не длина сессии.
 *
 * Подключённому клиенту сервер LiveKit продлевает токен сам. Короткий срок
 * нужен для отзыва: удалённый из комнаты гость не может войти снова с тем же
 * токеном дольше пяти минут, а за новым он придёт к нам, и мы проверим ссылку.
 */
export const ROOM_ACCESS_TTL_SECONDS = 300;

export const roomNameSchema = z.string().trim().min(1).max(80);

export const roomSchema = z.object({
  id: uuidSchema,
  name: roomNameSchema,
  createdAt: isoDateSchema,
});
export type Room = z.infer<typeof roomSchema>;

export const createRoomSchema = z.object({ name: roomNameSchema });
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

/**
 * Приглашение — ссылка на ОДНОГО гостя.
 *
 * Многоразовая (гость вправе перезагрузить вкладку), но с подписью: отзыв бьёт
 * ровно по одному человеку, и хранить в браузере гостя собственный секрет
 * сессии не нужно. Сам токен, как у ссылок OBS, виден один раз при выпуске.
 */
export const roomInviteViewSchema = z.object({
  id: uuidSchema,
  label: z.string().max(80),
  createdAt: isoDateSchema,
  /** Когда по ссылке последний раз входили. null — ни разу. */
  lastUsedAt: isoDateSchema.nullable(),
  revokedAt: isoDateSchema.nullable(),
  /**
   * Стример выключил гостю микрофон. Держится на приглашении, а не на
   * участнике: иначе гость снимал бы запрет перезагрузкой вкладки.
   */
  micBlocked: z.boolean(),
});
export type RoomInviteView = z.infer<typeof roomInviteViewSchema>;

export const createRoomInviteSchema = z.object({
  /** Кому ссылка: «Вася», «гость подкаста». Иначе в списке не понять, что отзывать. */
  label: z.string().trim().min(1).max(80),
});
export type CreateRoomInviteInput = z.infer<typeof createRoomInviteSchema>;

/** Ответ на выпуск приглашения. Ссылка с токеном возвращается единственный раз. */
export const createdRoomInviteSchema = z.object({
  id: uuidSchema,
  url: z.string().url(),
});
export type CreatedRoomInvite = z.infer<typeof createdRoomInviteSchema>;

/**
 * Доступ к комнате LiveKit: публичный адрес сервера и токен.
 *
 * Адрес приходит с сервера, а не зашит в сборку: он у LiveKit свой, отдельный от
 * API, и в разных окружениях разный. Токен — JWT, подписанный секретом LiveKit;
 * права в нём (публиковать, подписываться, быть невидимым) выставляет наш API.
 */
export const roomAccessSchema = z.object({
  url: z.string().regex(/^wss?:\/\//, 'Адрес LiveKit должен начинаться с ws:// или wss://'),
  token: z.string().min(1),
});
export type RoomAccess = z.infer<typeof roomAccessSchema>;

/** Имя гостя в кадре. В БД не пишется: живёт только в токене LiveKit. */
export const guestDisplayNameSchema = z.string().trim().min(1).max(40);

export const guestJoinSchema = z.object({
  token: z.string().min(1).max(200),
  displayName: guestDisplayNameSchema,
  /**
   * Согласие на передачу имени, изображения и голоса. Литерал `true`, а не
   * boolean: запрос без согласия отвергается схемой, до всякой логики.
   */
  acceptTerms: z.literal(true),
});
export type GuestJoinInput = z.infer<typeof guestJoinSchema>;

/** Ответ гостю: доступ и название комнаты, в которую он входит. */
export const guestJoinResultSchema = roomAccessSchema.extend({
  roomName: roomNameSchema,
  /**
   * Можно ли гостю включать микрофон. Страница не пытается опубликовать его при
   * входе, если нельзя: сервер отказал бы, и гость увидел бы ошибку вместо
   * объяснения.
   */
  microphoneAllowed: z.boolean(),
});
export type GuestJoinResult = z.infer<typeof guestJoinResultSchema>;

export const overlayRoomAccessSchema = z.object({
  token: z.string().min(1).max(200),
});
export type OverlayRoomAccessInput = z.infer<typeof overlayRoomAccessSchema>;

/* ------------------------------------------------------------------ */
/* Участники                                                           */
/* ------------------------------------------------------------------ */

export const PARTICIPANT_ROLES = ['host', 'guest', 'overlay'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/**
 * Идентичность участника в LiveKit.
 *
 * Роль зашита ПРЕФИКСОМ, который ставит наш сервер при выпуске токена, а не
 * атрибутом или метаданными, которые клиент вправе менять сам. Оверлей рендерит
 * только гостей, дашборд даёт удалить только гостей — и обе проверки опираются
 * на то, что подделать нельзя без секрета LiveKit.
 */
export function hostIdentity(userId: string): string {
  return `host:${userId}`;
}

/** Суффикс у гостя случайный: одна ссылка, открытая во второй вкладке, — два участника, а не выбитый первый. */
export function guestIdentity(inviteId: string, nonce: string): string {
  return `guest:${inviteId}:${nonce}`;
}

export function overlayIdentity(tokenId: string): string {
  return `overlay:${tokenId}`;
}

export interface ParsedIdentity {
  role: ParticipantRole;
  /** userId у стримера, inviteId у гостя, tokenId у оверлея. */
  id: string;
}

const IDENTITY = /^(host|overlay):([0-9a-f-]{36})$|^guest:([0-9a-f-]{36}):[A-Za-z0-9_-]{1,32}$/;

export function parseParticipantIdentity(identity: string): ParsedIdentity | null {
  const match = IDENTITY.exec(identity);
  if (!match) return null;
  if (match[3]) return { role: 'guest', id: match[3] };
  return { role: match[1] as ParticipantRole, id: match[2]! };
}

export const roomParticipantSchema = z.object({
  identity: z.string(),
  role: z.enum(PARTICIPANT_ROLES),
  name: z.string(),
  joinedAt: isoDateSchema,
  tracks: z.array(
    z.object({
      sid: z.string(),
      kind: z.enum(['audio', 'video']),
      muted: z.boolean(),
    }),
  ),
});
export type RoomParticipant = z.infer<typeof roomParticipantSchema>;

/* ------------------------------------------------------------------ */
/* Раскладка                                                           */
/* ------------------------------------------------------------------ */

/**
 * Раскладки гостей: три автоматические и свободная (`free`), где у каждого места
 * своя рамка в кадре (`seats` в конфиге виджета).
 */
export const GUEST_LAYOUTS = ['grid', 'row', 'column', 'free'] as const;
export type GuestLayout = (typeof GUEST_LAYOUTS)[number];

export interface LayoutGrid {
  /** Колонок в CSS-сетке. Вдвое больше видимых: так неполный ряд встаёт по центру. */
  columns: number;
  rows: number;
  /** Позиция каждой плитки: колонка начала (с единицы, плитка занимает две) и ряд. */
  tiles: Array<{ column: number; row: number }>;
}

/**
 * Раскладка плиток по CSS-сетке.
 *
 * Сетка в двойных колонках — известный приём центрирования: плитка занимает две
 * колонки, и неполный последний ряд сдвигается на одну, то есть на полплитки
 * за каждую недостающую. Пять гостей встают как 3 + 2 по центру, а не 3 + 2
 * прижатыми к левому краю, где в кадре обычно висит что-то ещё.
 *
 * Результат — номера колонок и рядов, а не пиксели. Размер браузер-сорса знает
 * только OBS, а сетке он не нужен: плитки растягиваются сами.
 */
export function layoutTiles(count: number, layout: GuestLayout): LayoutGrid {
  // Свободную раскладку сетка не считает — рамки мест заданы в конфиге. Здесь
  // она ведёт себя как сетка: так вызов с ней ничего не ломает.
  if (count <= 0) return { columns: 2, rows: 1, tiles: [] };

  const perRow = layout === 'row' ? count : layout === 'column' ? 1 : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / perRow);
  const tiles: LayoutGrid['tiles'] = [];

  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow);
    const inThisRow = row === rows - 1 ? count - row * perRow : perRow;
    const offset = perRow - inThisRow; // в половинках плитки
    const position = index - row * perRow;
    tiles.push({ column: offset + position * 2 + 1, row: row + 1 });
  }

  return { columns: perRow * 2, rows, tiles };
}
