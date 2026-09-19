import { Injectable } from '@nestjs/common';
import {
  type StreamChannel,
  type StreamChat,
  type StreamOverview,
  type StreamWidget,
  type ChatChannelRef,
  chatChannelKey,
} from '@streamkit/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PresenceService } from '../../common/redis/presence.service';
import { chatChannelsOf, toChannelRefs } from '../chat/chat-channel';
import {
  ANALYTICS_PLATFORMS,
  toContractPlatform,
  toContractSyncState,
} from '../integrations/platform.mappers';
import { toContractWidgetType } from '../widgets/widget.mappers';

/**
 * Окно эфира: сводка одним запросом и выбор канала чата.
 *
 * Всё собирается из того, что уже есть: снимки метрик пишет опрос площадок,
 * события — лента, подключённость ссылок OBS — отметки шлюза оверлея. Своих
 * данных у окна нет, и хранить ему нечего.
 */
@Injectable()
export class StreamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  async overview(userId: string): Promise<StreamOverview> {
    const [channels, chats, widgets] = await Promise.all([
      this.channels(userId),
      this.chatChannels(userId),
      this.widgets(userId),
    ]);
    return { channels, chats, widgets };
  }

  /**
   * Каналы чата окна эфира — подключённые в «Аналитике» площадки, и только
   * они (`chatChannels`). Нет подключений — нет и чата.
   *
   * Состояние — по отметке воркера. Без отметки Twitch считается читаемым
   * (IRC не зависит от эфира), а YouTube — ждущим эфира: чат у YouTube есть
   * только у идущей трансляции, и воркер ещё не успел её найти.
   */
  /** Только ссылки на каналы — для комнат оверлея, без состояния чтения. */
  async chatChannelRefs(userId: string): Promise<ChatChannelRef[]> {
    return toChannelRefs(await chatChannelsOf(this.prisma, userId));
  }

  async chatChannels(userId: string): Promise<StreamChat[]> {
    const chats = await chatChannelsOf(this.prisma, userId);
    const states = await this.presence.chatStates(chats);
    return chats.map((chat) => ({
      platform: chat.platform,
      channel: chat.channel,
      title: chat.title,
      state: chat.authExpired
        ? 'auth'
        : (states.get(chatChannelKey(chat)) ?? (chat.platform === 'youtube' ? 'waiting' : 'ok')),
    }));
  }

  private async channels(userId: string): Promise<StreamChannel[]> {
    const rows = await this.prisma.channel.findMany({
      where: { userId, platform: { in: ANALYTICS_PLATFORMS } },
      orderBy: { createdAt: 'asc' },
      include: {
        // Только последний снимок: у канала их тысячи, окну нужен один.
        snapshots: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: { capturedAt: true, isLive: true, viewers: true, title: true },
        },
      },
    });

    return rows.map((row) => {
      const latest = row.snapshots[0];
      const isLive = latest?.isLive ?? false;
      return {
        id: row.id,
        platform: toContractPlatform(row.platform),
        login: row.login,
        displayName: row.displayName,
        syncState: toContractSyncState(row.syncState),
        isLive,
        viewers: isLive ? (latest?.viewers ?? null) : null,
        liveSince: isLive ? (row.liveSince?.toISOString() ?? null) : null,
        title: isLive ? (latest?.title ?? null) : null,
        capturedAt: latest?.capturedAt.toISOString() ?? null,
      };
    });
  }

  private async widgets(userId: string): Promise<StreamWidget[]> {
    const rows = await this.prisma.widget.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        isEnabled: true,
        tokens: { where: { revokedAt: null }, select: { id: true } },
      },
    });

    const online = await this.presence.onlineOverlays(
      rows.flatMap((row) => row.tokens.map((token) => token.id)),
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: toContractWidgetType(row.type),
      isEnabled: row.isEnabled,
      links: row.tokens.length,
      connected: row.tokens.filter((token) => online.has(token.id)).length,
    }));
  }
}
