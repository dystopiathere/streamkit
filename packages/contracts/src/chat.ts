import { z } from 'zod';
import { hexColorSchema, isoDateSchema } from './common.js';

/**
 * Логин канала Twitch.
 *
 * Приводится к нижнему регистру прямо в схеме, и это не косметика. IRC-канал
 * называется `#shroud`, а стример впишет в настройки «Shroud»: JOIN пройдёт, но
 * сообщения придут с тегом в нижнем регистре, и ключ комнаты доставки перестанет
 * совпадать с тем, по которому оверлей подписался. Нормализация в одном месте
 * закрывает это и на сервере, и в форме.
 */
export const twitchLoginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{1,25}$/, 'Логин канала Twitch: латиница, цифры и подчёркивание');

/**
 * Идентификатор канала YouTube — `UC` и 22 символа.
 *
 * Канал чата YouTube адресуется им, а не адресом `@handle`: адрес канал может
 * сменить в любой момент, и комната доставки разошлась бы с каналом сообщений.
 */
export const youtubeChannelIdSchema = z
  .string()
  .regex(/^UC[A-Za-z0-9_-]{22}$/, 'Идентификатор канала YouTube: UC и 22 символа');

/** Площадки, чат которых умеет читать сервис. */
export const CHAT_PLATFORMS = ['twitch', 'youtube'] as const;
export const chatPlatformSchema = z.enum(CHAT_PLATFORMS);
export type ChatPlatform = z.infer<typeof chatPlatformSchema>;

/**
 * Канал чата: площадка и её идентификатор канала. Логин Twitch и id канала
 * YouTube — разные алфавиты, и каждый проверяется схемой своей площадки: логин
 * Twitch уходит в команду IRC, и перевод строки в нём был бы второй командой.
 */
export const chatChannelRefSchema = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('twitch'), channel: twitchLoginSchema }),
  z.object({ platform: z.literal('youtube'), channel: youtubeChannelIdSchema }),
]);
export type ChatChannelRef = z.infer<typeof chatChannelRefSchema>;

/** Ключ канала для множеств и отметок: `twitch:shroud`, `youtube:UC…`. */
export function chatChannelKey(ref: { platform: string; channel: string }): string {
  return `${ref.platform}:${ref.channel}`;
}

/**
 * Значки автора, которые виджет умеет показывать.
 *
 * Список Twitch открыт и пополняется (значки подписок на месяцы, значки
 * событий, партнёрские программы). Неизвестные отбрасываются при разборе, а не
 * роняют сообщение: чат в эфире не должен молчать из-за нового значка.
 */
export const CHAT_BADGES = [
  'broadcaster',
  'moderator',
  'vip',
  'subscriber',
  'founder',
  'artist',
  'partner',
  'staff',
  'turbo',
  'premium',
  // YouTube: спонсор канала и подтверждённый автор. Модератор и владелец
  // канала ложатся на значки Twitch выше.
  'member',
  'verified',
] as const;
export const chatBadgeSchema = z.enum(CHAT_BADGES);
export type ChatBadge = z.infer<typeof chatBadgeSchema>;

/**
 * Кусок сообщения: либо текст, либо эмоут.
 *
 * Сообщение приезжает в оверлей УЖЕ разобранным на части, а не строкой с
 * координатами эмоутов. Причина — правило репозитория: `dangerouslySetInnerHTML`
 * запрещён, оверлей открыт по публичной ссылке. Тот же приём уже применён к
 * шаблонам алертов: подстановка идёт по частям, а не по готовой разметке.
 */
export const chatPartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string().max(500) }),
  z.object({
    kind: z.literal('emote'),
    /** Идентификатор в CDN Twitch. Ограничен так, чтобы из него нельзя было собрать чужой адрес. */
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    /** Исходный код эмоута: подпись картинки, если она не загрузилась. */
    alt: z.string().max(64),
  }),
]);
export type ChatPart = z.infer<typeof chatPartSchema>;

const chatMessageBase = {
  /** Идентификатор сообщения у площадки: тег `id` IRC, `id` сообщения YouTube. */
  id: z.string().min(1).max(128),
  /** Отображаемое имя: может отличаться регистром и алфавитом. */
  username: z.string().min(1).max(100),
  /** Цвет ника из тега. null — площадка его не прислала, цвет выберет виджет. */
  color: hexColorSchema.nullable(),
  badges: z.array(chatBadgeSchema).max(8),
  parts: z.array(chatPartSchema).max(200),
  sentAt: isoDateSchema,
};

/**
 * Сообщение чата любой площадки.
 *
 * `login` — постоянный идентификатор автора: логин Twitch или id канала
 * YouTube. По нему, а не по имени, работает дедупликация и ключи; список
 * скрытых сверяется и с ним, и с именем — боты YouTube узнаются по имени.
 */
export const chatMessageSchema = z.discriminatedUnion('platform', [
  z.object({
    ...chatMessageBase,
    platform: z.literal('twitch'),
    channel: twitchLoginSchema,
    login: twitchLoginSchema,
  }),
  z.object({
    ...chatMessageBase,
    platform: z.literal('youtube'),
    channel: youtubeChannelIdSchema,
    login: youtubeChannelIdSchema,
  }),
]);
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Диапазон эмоута в тексте сообщения. Границы включительные, как их шлёт Twitch. */
export interface EmoteRange {
  id: string;
  start: number;
  end: number;
}

const EMOTE_CDN = 'https://static-cdn.jtvnw.net/emoticons/v2';

/**
 * Адрес картинки эмоута.
 *
 * Собирается из идентификатора, а не приходит ссылкой от площадки: ссылка в
 * сообщении означала бы, что чужой сервис решает, откуда оверлей грузит
 * картинки, а оверлей открыт по публичной ссылке и висит поверх эфира.
 */
export function emoteUrl(id: string, scale: 1 | 2 | 3 = 2): string {
  return `${EMOTE_CDN}/${id}/default/dark/${scale}.0`;
}

/**
 * Текст сообщения → части с эмоутами на своих местах.
 *
 * Twitch нумерует позиции в КОДОВЫХ ТОЧКАХ, а не в единицах UTF-16, которыми
 * меряет `String.prototype.slice`. Одна эмодзи в сообщении сдвигает все
 * последующие эмоуты на единицу, и картинки уезжают на соседние слова —
 * поэтому текст режется по `Array.from`, а не по индексам строки.
 *
 * Диапазоны приходят в произвольном порядке и могут быть битыми (вылезать за
 * границы, пересекаться): это данные из сети, а не наши. Битые пропускаются,
 * сообщение показывается текстом.
 */
export function splitEmotes(text: string, ranges: EmoteRange[]): ChatPart[] {
  const points = Array.from(text);
  const sorted = [...ranges]
    .filter((range) => range.start >= 0 && range.end >= range.start && range.end < points.length)
    .sort((a, b) => a.start - b.start);

  const parts: ChatPart[] = [];
  let cursor = 0;

  for (const range of sorted) {
    // Пересечение с уже разобранным: доверять такому диапазону нечему.
    if (range.start < cursor) continue;

    if (range.start > cursor) {
      parts.push({ kind: 'text', value: points.slice(cursor, range.start).join('') });
    }
    parts.push({
      kind: 'emote',
      id: range.id,
      alt: points.slice(range.start, range.end + 1).join(''),
    });
    cursor = range.end + 1;
  }

  if (cursor < points.length) {
    parts.push({ kind: 'text', value: points.slice(cursor).join('') });
  }
  return parts;
}
