import { z } from 'zod';
import { channelSyncStateSchema, platformSchema } from './analytics.js';
import { chatPlatformSchema } from './chat.js';
import { isoDateSchema, uuidSchema } from './common.js';
import { widgetTypeSchema } from './widgets.js';

/**
 * Окно эфира: всё, что стримеру нужно видеть во время трансляции, одним
 * запросом. Дальше окно живёт сокетом — чат, события и свежие метрики.
 */

/** Канал площадки в окне эфира: идёт ли эфир, с какого момента и сколько зрителей. */
export const streamChannelSchema = z.object({
  id: uuidSchema,
  platform: platformSchema,
  login: z.string(),
  displayName: z.string(),
  syncState: channelSyncStateSchema,
  isLive: z.boolean(),
  /** Зрители по последнему снимку. null — эфира нет или площадка не сообщила. */
  viewers: z.number().int().nonnegative().nullable(),
  /** Начало эфира по часам площадки. */
  liveSince: isoDateSchema.nullable(),
  title: z.string().nullable(),
  /** Когда снят последний снимок. null — метрики ещё ни разу не собирались. */
  capturedAt: isoDateSchema.nullable(),
});
export type StreamChannel = z.infer<typeof streamChannelSchema>;

/**
 * Что происходит с чтением чата канала.
 *
 * - `ok` — читаем (или вот-вот начнём, в пределах такта воркера);
 * - `waiting` — эфира нет, а чат YouTube существует только у идущего эфира;
 * - `quota` — суточный бюджет чата YouTube исчерпан до полуночи по
 *   тихоокеанскому времени;
 * - `auth` — площадка отозвала доступ, канал нужно переподключить.
 */
export const CHAT_STATES = ['ok', 'waiting', 'quota', 'auth'] as const;
export const chatStateSchema = z.enum(CHAT_STATES);
export type ChatState = z.infer<typeof chatStateSchema>;

/**
 * Канал чата окна — только подключённые в «Аналитике» площадки: вход на
 * площадке доказывает, что канал принадлежит стримеру. Канала из настроек
 * виджета больше нет — через него в окно можно было вывести любой чужой чат.
 */
export const streamChatSchema = z.object({
  platform: chatPlatformSchema,
  /** Логин Twitch или id канала YouTube — ключ комнаты доставки. */
  channel: z.string().min(1),
  /** Как канал называется у площадки: id YouTube человеку ничего не скажет. */
  title: z.string(),
  state: chatStateSchema,
});
export type StreamChat = z.infer<typeof streamChatSchema>;

export const streamWidgetSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  type: widgetTypeSchema,
  isEnabled: z.boolean(),
  /** Невыключенные ссылки OBS. */
  links: z.number().int().nonnegative(),
  /** Из них подключены к OBS прямо сейчас. */
  connected: z.number().int().nonnegative(),
});
export type StreamWidget = z.infer<typeof streamWidgetSchema>;

export const streamOverviewSchema = z.object({
  channels: z.array(streamChannelSchema),
  chats: z.array(streamChatSchema),
  widgets: z.array(streamWidgetSchema),
});
export type StreamOverview = z.infer<typeof streamOverviewSchema>;

/** Ответ на `stream:watch`: чаты каких каналов окно будет получать. */
export const streamWatchAckSchema = z.object({ chats: z.array(streamChatSchema) });
export type StreamWatchAck = z.infer<typeof streamWatchAckSchema>;

/**
 * Пауза между ручными обновлениями метрик.
 *
 * Ручной опрос нужен потому, что расписание не может быть частым: вне эфира
 * канал опрашивается раз в пятнадцать минут, и это упирается в суточную квоту
 * YouTube, а не в нашу лень (см. `IDLE_INTERVAL_MS`). Начало эфира на Twitch
 * приходит событием сразу, у YouTube такого события нет — там ждать до
 * четверти часа, и кнопка закрывает именно этот разрыв.
 *
 * Полминуты — чтобы нажатие не превращалось в опрос чаще, чем идёт эфирный
 * такт: чаще всё равно нечего показать, а квота YouTube общая на весь проект.
 * Значение в контракте, потому что его знают оба конца: сервер отказывает,
 * дашборд показывает отсчёт на кнопке.
 */
export const STREAM_REFRESH_COOLDOWN_MS = 30_000;

/**
 * Итог ручного обновления.
 *
 * Сводка приезжает в том же ответе: кнопка обновляет окно целиком, а не
 * заставляет дашборд делать второй запрос за тем, что сервер только что
 * посчитал.
 *
 * `throttled` — «слишком часто», и это не ошибка: обычное 429 клиент показал бы
 * красным, хотя ничего не сломалось и данные в ответе свежие.
 */
export const streamRefreshSchema = z.object({
  overview: streamOverviewSchema,
  throttled: z.boolean(),
  /** Когда можно нажать снова. */
  nextRefreshAt: isoDateSchema,
});
export type StreamRefresh = z.infer<typeof streamRefreshSchema>;

/**
 * Время стрима — от самого раннего начала среди идущих эфиров.
 *
 * Мультистрим начинают на площадках не одной кнопкой: разница в минуту между
 * Twitch и YouTube — обычное дело, а стример считает эфир от первой.
 */
export function streamStartedAt(
  channels: Pick<StreamChannel, 'isLive' | 'liveSince'>[],
): string | null {
  let earliest: string | null = null;
  for (const channel of channels) {
    if (!channel.isLive || !channel.liveSince) continue;
    if (earliest === null || Date.parse(channel.liveSince) < Date.parse(earliest)) {
      earliest = channel.liveSince;
    }
  }
  return earliest;
}

/** Суммарные зрители идущих эфиров. null — ни одна площадка в эфире число не сообщила. */
export function totalViewers(channels: Pick<StreamChannel, 'isLive' | 'viewers'>[]): number | null {
  const counts = channels.filter((channel) => channel.isLive && channel.viewers !== null);
  return counts.length === 0
    ? null
    : counts.reduce((sum, channel) => sum + (channel.viewers ?? 0), 0);
}
