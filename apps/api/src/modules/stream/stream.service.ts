import { Injectable } from '@nestjs/common';
import {
  chatWidgetConfigSchema,
  type StreamChannel,
  type StreamChat,
  type StreamOverview,
  type StreamWidget,
} from '@streamkit/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PresenceService } from '../../common/redis/presence.service';
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
    const [channels, chat, widgets] = await Promise.all([
      this.channels(userId),
      this.chatChannel(userId),
      this.widgets(userId),
    ]);
    return { channels, chat, widgets };
  }

  /**
   * Канал чата для окна эфира.
   *
   * Сначала — подключённый в «Аналитике» Twitch: это канал самого стримера, и
   * вписывать его ещё раз незачем. Нет подключённого — канал из виджета чата
   * (соглашение, раздел 13.2, называет оба). Логин Twitch всегда в нижнем
   * регистре, а IRC различает регистр в имени канала.
   */
  async chatChannel(userId: string): Promise<StreamChat | null> {
    const connected = await this.prisma.channel.findFirst({
      where: { userId, platform: 'TWITCH' },
      orderBy: { createdAt: 'asc' },
      select: { login: true },
    });
    if (connected) {
      return { platform: 'twitch', channel: connected.login.toLowerCase(), source: 'connected' };
    }

    const widgets = await this.prisma.widget.findMany({
      where: { userId, type: 'CHAT', isEnabled: true },
      orderBy: { createdAt: 'asc' },
      select: { config: true },
    });
    for (const widget of widgets) {
      const config = chatWidgetConfigSchema.safeParse(widget.config);
      if (config.success && config.data.channel.length > 0) {
        return { platform: 'twitch', channel: config.data.channel, source: 'widget' };
      }
    }
    return null;
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
