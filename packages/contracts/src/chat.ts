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
 * Канал в настройках виджета, который ещё не настроили.
 *
 * Пустая строка допустима намеренно: виджет создаётся кнопкой «Новый виджет»
 * с пустым конфигом, как и остальные четыре типа, а канал вписывается уже в
 * редакторе. Требовать логин прямо в схеме значило бы либо спрашивать его в
 * форме создания (у одного типа из пяти), либо запрещать создание виджета.
 * Пустой канал никуда не подключается и ничего не показывает.
 */
export const chatChannelSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^([a-z0-9_]{1,25})?$/, 'Логин канала Twitch: латиница, цифры и подчёркивание')
  .default('');

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

export const chatMessageSchema = z.object({
  /** Тег `id` из IRC. Он же ключ дедупликации между репликами воркера. */
  id: z.string().min(1).max(64),
  platform: z.literal('twitch'),
  channel: twitchLoginSchema,
  /** Логин автора: по нему работают фильтры, он же ключ списка скрытых. */
  login: twitchLoginSchema,
  /** Отображаемое имя: может отличаться регистром и алфавитом. */
  username: z.string().min(1).max(64),
  /** Цвет ника из тега. null — Twitch его не прислал, цвет выберет виджет. */
  color: hexColorSchema.nullable(),
  badges: z.array(chatBadgeSchema).max(8),
  parts: z.array(chatPartSchema).max(200),
  sentAt: isoDateSchema,
});
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
