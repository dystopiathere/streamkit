import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DonationService, DonationSources } from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DonationAlertsApi } from './donationalerts.api';
import { OAuthStateService } from './oauth-state.service';
import { PlatformTokenService } from './platform-token.service';

/**
 * Донат-сервисы стримера: что подключено, подключение и отключение.
 *
 * Сокет с донатами держит воркер (`ConnectorManager`); здесь только то, что
 * делает сам стример из дашборда. Воркер узнаёт о новом источнике сверкой с
 * БД на своём такте — канала команд воркеру в проекте нет.
 */
@Injectable()
export class DonationSourcesService {
  private readonly logger = new Logger(DonationSourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly donationAlerts: DonationAlertsApi,
    private readonly tokens: PlatformTokenService,
    private readonly state: OAuthStateService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<DonationSources> {
    const sources = await this.prisma.donationSource.findMany({ where: { userId } });
    const alerts = sources.find((source) => source.provider === 'DONATIONALERTS');
    const webhook = sources.find((source) => source.provider === 'WEBHOOK');

    return {
      services: [
        {
          service: 'donationalerts',
          title: 'DonationAlerts',
          isConfigured: this.donationAlerts.isConfigured,
          isConnected: alerts !== undefined,
          isEnabled: alerts?.isEnabled ?? false,
          accountName: alerts?.accountName ?? null,
          disabledReason: alerts?.disabledReason ?? null,
          lastEventAt: alerts?.lastEventAt?.toISOString() ?? null,
        },
      ],
      webhook: webhook
        ? {
            sourceId: webhook.id,
            isEnabled: webhook.isEnabled,
            lastEventAt: webhook.lastEventAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  async buildAuthorizeUrl(
    userId: string,
    service: DonationService,
  ): Promise<{ url: string; state: string }> {
    if (service !== 'donationalerts' || !this.donationAlerts.isConfigured) {
      throw new BadRequestException('Этот сервис сейчас недоступен');
    }
    const state = await this.state.issue(userId, service);
    return { url: this.donationAlerts.buildAuthorizeUrl(state), state };
  }

  /**
   * Возврат из DonationAlerts: код на токены, профиль, источник.
   *
   * Повторное подключение — это и есть починка: оно включает источник и
   * стирает причину, по которой его выключили.
   */
  async completeAuthorization(
    service: DonationService,
    code: string,
    rawState: string,
    browserState: string | undefined,
    context: AuditContext = {},
  ): Promise<void> {
    const { state, boundToBrowser } = await this.state.consumeFromBrowser(
      rawState,
      browserState,
      service,
    );
    if (!state) {
      await this.audit.record('integration.state.invalid', null, {
        ...context,
        metadata: { platform: service, boundToBrowser },
      });
      throw new BadRequestException('Ссылка подключения недействительна, начните заново');
    }

    const tokens = await this.donationAlerts.exchangeCode(code);
    const profile = await this.donationAlerts.fetchProfile(tokens.accessToken);

    await this.tokens.save(state.userId, service, tokens);
    await this.prisma.donationSource.upsert({
      where: { userId_provider: { userId: state.userId, provider: 'DONATIONALERTS' } },
      create: {
        userId: state.userId,
        provider: 'DONATIONALERTS',
        externalAccountId: profile.id,
        accountName: profile.name,
      },
      update: {
        externalAccountId: profile.id,
        accountName: profile.name,
        isEnabled: true,
        disabledReason: null,
      },
    });
    await this.audit.record('integration.connected', state.userId, {
      ...context,
      metadata: { platform: service, externalId: profile.id },
    });
    this.logger.log({ platform: service, userId: state.userId }, 'Донат-сервис подключён');
  }

  /** Отключение: источник и токены уходят вместе, воркер закроет сокет на такте. */
  async disconnect(
    userId: string,
    service: DonationService,
    context: AuditContext = {},
  ): Promise<void> {
    await this.prisma.donationSource.deleteMany({
      where: { userId, provider: 'DONATIONALERTS' },
    });
    await this.tokens.remove(userId, service);
    await this.audit.record('integration.disconnected', userId, {
      ...context,
      metadata: { platform: service },
    });
  }
}
