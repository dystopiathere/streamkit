import { type ChatChannelRef, chatChannelRefSchema } from '@streamkit/contracts';
import type { PrismaService } from '../../common/prisma/prisma.service';

/** Канал чата подключённой площадки: куда слушать и как его назвать человеку. */
export type ConnectedChat = ChatChannelRef & {
  /** Название канала у площадки: id YouTube человеку ничего не скажет. */
  title: string;
  /** Площадка отозвала доступ. Чат YouTube без токена не читается. */
  authExpired: boolean;
};

/**
 * Каналы чата пользователя — подключённые в «Аналитике» площадки, и только они.
 *
 * Только подключённые по OAuth: вход на площадке доказывает, что канал
 * принадлежит стримеру. Раньше канал вписывался в настройки виджета, и в эфир
 * можно было вывести чат любого чужого канала — сообщения и ники его зрителей
 * шли через платформу без ведома того стримера.
 *
 * Twitch — по логину: он и есть имя IRC-канала. YouTube — по id канала `UC…`,
 * а не по адресу `@handle`, который канал вправе сменить.
 *
 * Каждый идентификатор проверяется схемой, хотя пришёл от площадки: логин
 * Twitch уходит в команду IRC `JOIN #<логин>`, и перевод строки в нём был бы
 * второй командой.
 */
export async function chatChannels(
  prisma: PrismaService,
  userIds: string[],
): Promise<Map<string, ConnectedChat[]>> {
  const result = new Map<string, ConnectedChat[]>();
  if (userIds.length === 0) return result;

  const rows = await prisma.channel.findMany({
    // Только включённые: выключенная площадка не работает нигде — ни в опросе
    // метрик, ни в событиях, ни в чате. На тарифе с одной площадкой их две, и
    // чат второй идти не должен.
    where: { userId: { in: userIds }, isEnabled: true, platform: { in: ['TWITCH', 'YOUTUBE'] } },
    // Twitch раньше YouTube, внутри площадки — по времени подключения: порядок
    // подписей в окне эфира не должен прыгать от запроса к запросу.
    orderBy: [{ platform: 'asc' }, { createdAt: 'asc' }],
    select: {
      userId: true,
      platform: true,
      login: true,
      externalId: true,
      displayName: true,
      syncState: true,
    },
  });

  for (const row of rows) {
    const ref = chatChannelRefSchema.safeParse(
      row.platform === 'TWITCH'
        ? { platform: 'twitch', channel: row.login }
        : { platform: 'youtube', channel: row.externalId },
    );
    if (!ref.success) continue;
    const list = result.get(row.userId) ?? [];
    list.push({
      ...ref.data,
      title: row.displayName,
      // Чат Twitch читается анонимно — отозванный токен ему не помеха.
      authExpired: ref.data.platform === 'youtube' && row.syncState === 'AUTH_EXPIRED',
    });
    result.set(row.userId, list);
  }
  return result;
}

/** Каналы чата одного пользователя. */
export async function chatChannelsOf(
  prisma: PrismaService,
  userId: string,
): Promise<ConnectedChat[]> {
  return (await chatChannels(prisma, [userId])).get(userId) ?? [];
}

/** Только ссылки на каналы — то, что уходит в оверлей. */
export function toChannelRefs(chats: ConnectedChat[]): ChatChannelRef[] {
  return chats.map(({ platform, channel }) => ({ platform, channel }) as ChatChannelRef);
}
