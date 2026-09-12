import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AvailablePlatform, Platform } from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
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

  /** Ссылка, по которой пользователь уходит логиниться на площадку. */
  async buildAuthorizeUrl(userId: string, platform: Platform): Promise<string> {
    const provider = this.registry.find(platform);
    if (!provider) {
      throw new BadRequestException('Эта площадка сейчас недоступна');
    }
    return provider.buildAuthorizeUrl(await this.state.issue(userId, platform));
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
    context: AuditContext = {},
  ): Promise<{ userId: string }> {
    const state = await this.state.consume(rawState, platform);
    if (!state) {
      // Может быть чем угодно: истёкшим состоянием, повторным заходом по той же
      // ссылке, попыткой подделки. Снаружи все три выглядят одинаково.
      await this.audit.record('integration.state.invalid', null, {
        ...context,
        metadata: { platform },
      });
      throw new BadRequestException('Ссылка подключения недействительна, начните заново');
    }

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
    await this.audit.record('integration.connected', state.userId, {
      ...context,
      metadata: { platform, externalId: identity.externalId },
    });
    this.logger.log({ platform, userId: state.userId }, 'Площадка подключена');

    return { userId: state.userId };
  }

  /** Отключение: канал и учётные данные уходят вместе со снимками метрик. */
  async disconnect(userId: string, platform: Platform, context: AuditContext = {}): Promise<void> {
    await this.prisma.channel.deleteMany({
      where: { userId, platform: toPrismaPlatform(platform) },
    });
    await this.tokens.remove(userId, platform);
    await this.audit.record('integration.disconnected', userId, {
      ...context,
      metadata: { platform },
    });
  }
}
