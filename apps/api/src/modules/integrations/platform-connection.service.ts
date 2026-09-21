import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AvailablePlatform, Platform } from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { RealtimeBus } from '../../common/bus/realtime-bus.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { chatChannelsOf, toChannelRefs } from '../chat/chat-channel';
import { OAuthStateService } from './oauth-state.service';
import { PlatformRegistry } from './platform-registry.service';
import { PlatformTokenService } from './platform-token.service';
import { toPrismaPlatform } from './platform.mappers';

/**
 * Подключение и отключение площадки.
 *
 * Здесь живёт OAuth-контур целиком: раньше его не было вовсе — интерфейс
 * `OAuthProviderConfig` был объявлен, но ни одна строчка кода не выпускала
 * ссылку авторизации, не меняла код на токен и не писала `IntegrationCredential`.
 */
@Injectable()
export class PlatformConnectionService {
  private readonly logger = new Logger(PlatformConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PlatformRegistry,
    private readonly tokens: PlatformTokenService,
    private readonly state: OAuthStateService,
    private readonly audit: AuditService,
    private readonly bus: RealtimeBus,
    private readonly billing: BillingService,
  ) {}

  async listAvailable(userId: string): Promise<AvailablePlatform[]> {
    const channels = await this.prisma.channel.findMany({
      where: { userId },
      select: { platform: true },
    });
    const connected = new Set<Platform>(
      channels.map((channel) => channel.platform.toLowerCase() as Platform),
    );
    return this.registry.list(connected);
  }

  /**
   * Ссылка, по которой пользователь уходит логиниться на площадку, и state —
   * контроллер кладёт его в cookie браузера (`oauth-state-cookie.ts`).
   */
  async buildAuthorizeUrl(
    userId: string,
    platform: Platform,
  ): Promise<{ url: string; state: string }> {
    const provider = this.registry.find(platform);
    if (!provider) {
      throw new BadRequestException('Эта площадка сейчас недоступна');
    }
    const state = await this.state.issue(userId, platform);
    return { url: provider.buildAuthorizeUrl(state), state };
  }

  /**
   * Завершение подключения: обмен кода на токены и запись канала.
   *
   * @returns id пользователя, которому принадлежит подключение — контроллер
   *          знать его заранее не может, `@Public()` ручка не видит сессии.
   */
  async completeAuthorization(
    platform: Platform,
    code: string,
    rawState: string,
    browserState: string | undefined,
    context: AuditContext = {},
  ): Promise<{ userId: string }> {
    const { state, boundToBrowser } = await this.state.consumeFromBrowser(
      rawState,
      browserState,
      platform,
    );
    if (!state) {
      // Может быть чем угодно: истёкшим состоянием, повторным заходом по той же
      // ссылке, попыткой подделки. Снаружи все три выглядят одинаково.
      await this.audit.record('integration.state.invalid', null, {
        ...context,
        metadata: { platform, boundToBrowser },
      });
      throw new BadRequestException('Ссылка подключения недействительна, начните заново');
    }

    // Лимит площадок — до обмена кода: получить и сохранить токены площадки,
    // которую мы всё равно не подключим, значит завести мёртвые учётные данные.
    // Повторное подключение той же площадки разрешено всегда: это единственный
    // способ починить протухший доступ.
    await this.requirePlatformSlot(state.userId, platform);

    const provider = this.registry.require(platform);
    const tokens = await provider.exchangeCode(code);
    const identity = await provider.fetchIdentity(tokens.accessToken);

    await this.prisma.channel.upsert({
      where: { userId_platform: { userId: state.userId, platform: toPrismaPlatform(platform) } },
      create: {
        userId: state.userId,
        platform: toPrismaPlatform(platform),
        externalId: identity.externalId,
        login: identity.login,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
      },
      update: {
        externalId: identity.externalId,
        login: identity.login,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        isEnabled: true,
        // Повторное подключение — это и есть починка протухшего доступа.
        syncState: 'OK',
        syncError: null,
      },
    });

    await this.tokens.save(state.userId, platform, tokens);
    await this.announceChatChannels(state.userId);
    await this.audit.record('integration.connected', state.userId, {
      ...context,
      metadata: { platform, externalId: identity.externalId },
    });
    this.logger.log({ platform, userId: state.userId }, 'Площадка подключена');

    return { userId: state.userId };
  }

  /**
   * Есть ли на тарифе место под ещё одну площадку.
   *
   * Отказ — 403, а не 402: контроллер приводит его к возврату на «Аналитику» с
   * меткой `plan-limit`, и страница объясняет, что делать. Коду ответа здесь
   * значения не придаётся — ответ отдаётся редиректом, а не телом.
   *
   * Уже подключённая площадка место не занимает: повторное подключение — это
   * починка протухшего доступа, и запрещать её значило бы запереть стримера
   * без возможности вернуть свой же канал.
   */
  private async requirePlatformSlot(userId: string, platform: Platform): Promise<void> {
    const { platforms: limit } = await this.billing.planFeatures(userId);
    if (limit === null) return;

    const connected = await this.prisma.channel.findMany({
      where: { userId },
      select: { platform: true },
    });
    const prisma = toPrismaPlatform(platform);
    if (connected.some((channel) => channel.platform === prisma)) return;
    if (connected.length >= limit) {
      throw new ForbiddenException('Тариф не позволяет подключить ещё одну площадку');
    }
  }

  /**
   * Включение и выключение площадки.
   *
   * Выключенный канал не опрашивается, не читает чат и не присылает события —
   * так тариф с одной площадкой работает у стримера, подключившего две: обе
   * остаются на месте, работает выбранная. Поэтому включение одной выключает
   * остальные, и обе операции идут одной транзакцией: между ними не должно
   * быть мгновения, когда активны обе или ни одна.
   */
  async setEnabled(
    userId: string,
    channelId: string,
    isEnabled: boolean,
    context: AuditContext = {},
  ): Promise<void> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
      select: { id: true, platform: true },
    });
    if (!channel) throw new NotFoundException('Канал не найден');

    const { platforms: limit } = await this.billing.planFeatures(userId);
    const exclusive = isEnabled && limit !== null && limit <= 1;

    await this.prisma.$transaction(async (tx) => {
      if (exclusive) {
        await tx.channel.updateMany({
          where: { userId, id: { not: channelId } },
          data: { isEnabled: false },
        });
      }
      await tx.channel.update({ where: { id: channelId }, data: { isEnabled } });
    });

    await this.announceChatChannels(userId);
    await this.audit.record('integration.channel.toggled', userId, {
      ...context,
      metadata: { platform: channel.platform.toLowerCase(), isEnabled },
    });
  }

  /** Отключение: канал и учётные данные уходят вместе со снимками метрик. */
  async disconnect(userId: string, platform: Platform, context: AuditContext = {}): Promise<void> {
    await this.prisma.channel.deleteMany({
      where: { userId, platform: toPrismaPlatform(platform) },
    });
    await this.tokens.remove(userId, platform);
    await this.announceChatChannels(userId);
    await this.audit.record('integration.disconnected', userId, {
      ...context,
      metadata: { platform },
    });
  }

  /**
   * Каналы чата пользователя — подключённые площадки. Сменился аккаунт или
   * площадку отключили — открытые оверлеи чата переходят на новые каналы или
   * замолкают сразу, а не после перезагрузки сцены в OBS.
   */
  private async announceChatChannels(userId: string): Promise<void> {
    await this.bus
      .publish({
        kind: 'chat-channel',
        userId,
        channels: toChannelRefs(await chatChannelsOf(this.prisma, userId)),
      })
      .catch((error: unknown) =>
        this.logger.warn({ err: error }, 'Смена канала чата не разослана'),
      );
  }
}
