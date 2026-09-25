import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ApiKeyDonationService,
  DonationService,
  DonationServiceView,
  DonationSources,
} from '@streamkit/contracts';
import type { DonationSource, EventProvider } from '@prisma/client';
import type { Redis } from 'ioredis';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { PlatformAuthError } from '../../common/http/platform-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { DonatePayApi, type DonatePayProfile } from './donatepay.api';
import { donatePayCursorKey } from './donatepay.connector';
import { DonationAlertsApi } from './donationalerts.api';
import { OAuthStateService } from './oauth-state.service';
import { PlatformTokenService } from './platform-token.service';

/** Строка источника в БД для каждого сервиса. */
const SERVICE_PROVIDERS = {
  donationalerts: 'DONATIONALERTS',
  donatepay: 'DONATEPAY',
} as const satisfies Record<DonationService, EventProvider>;

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
    private readonly donatePay: DonatePayApi,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tokens: PlatformTokenService,
    private readonly state: OAuthStateService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<DonationSources> {
    const sources = await this.prisma.donationSource.findMany({ where: { userId } });
    const find = (provider: EventProvider): DonationSource | undefined =>
      sources.find((source) => source.provider === provider);
    const webhook = find('WEBHOOK');

    return {
      services: [
        serviceView(
          'donationalerts',
          'DonationAlerts',
          'oauth',
          this.donationAlerts.isConfigured,
          find('DONATIONALERTS'),
        ),
        // Приложение у DonatePay регистрировать не нужно: стример приносит свой
        // ключ, поэтому сервис настроен всегда.
        serviceView('donatepay', 'DonatePay', 'api_key', true, find('DONATEPAY')),
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

  /**
   * Подключение ключом API: ключ проверяется профилем владельца и хранится
   * шифротекстом там же, где OAuth-токены других сервисов.
   *
   * Новый ключ — это и починка выключенного источника, как повторный вход у
   * DonationAlerts. Курсор опроса сбрасывается: подключение показывает только
   * донаты, пришедшие после него, а не историю аккаунта.
   */
  async connectWithKey(
    userId: string,
    service: ApiKeyDonationService,
    apiKey: string,
    context: AuditContext = {},
  ): Promise<void> {
    let profile: DonatePayProfile;
    try {
      profile = await this.donatePay.fetchProfile(apiKey);
    } catch (error) {
      if (error instanceof PlatformAuthError) {
        throw new BadRequestException(
          'DonatePay не принял ключ API — скопируйте его заново на странице API в кабинете DonatePay',
        );
      }
      this.logger.warn({ err: error, service }, 'DonatePay не проверил ключ API');
      throw new ServiceUnavailableException(
        'DonatePay не смог проверить ключ — попробуйте через минуту',
      );
    }

    await this.tokens.save(userId, service, {
      accessToken: apiKey,
      refreshToken: null,
      scopes: [],
      expiresAt: null,
    });
    await this.prisma.donationSource.upsert({
      where: { userId_provider: { userId, provider: SERVICE_PROVIDERS[service] } },
      create: {
        userId,
        provider: SERVICE_PROVIDERS[service],
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
    await this.redis.del(donatePayCursorKey(userId, profile.id));
    await this.audit.record('integration.connected', userId, {
      ...context,
      metadata: { platform: service, externalId: profile.id },
    });
    this.logger.log({ platform: service, userId }, 'Донат-сервис подключён');
  }

  /** Отключение: источник и токены уходят вместе, воркер закроет соединение на такте. */
  async disconnect(
    userId: string,
    service: DonationService,
    context: AuditContext = {},
  ): Promise<void> {
    await this.prisma.donationSource.deleteMany({
      where: { userId, provider: SERVICE_PROVIDERS[service] },
    });
    await this.tokens.remove(userId, service);
    await this.audit.record('integration.disconnected', userId, {
      ...context,
      metadata: { platform: service },
    });
  }
}

function serviceView(
  service: DonationService,
  title: string,
  connection: DonationServiceView['connection'],
  isConfigured: boolean,
  source: DonationSource | undefined,
): DonationServiceView {
  return {
    service,
    title,
    connection,
    isConfigured,
    isConnected: source !== undefined,
    isEnabled: source?.isEnabled ?? false,
    accountName: source?.accountName ?? null,
    disabledReason: source?.disabledReason ?? null,
    lastEventAt: source?.lastEventAt?.toISOString() ?? null,
  };
}
