import { Module } from '@nestjs/common';
import { HttpClient } from '../../common/http/http-client.service';
import { BillingModule } from '../billing/billing.module';
import { EventsModule } from '../events/events.module';
import { ConnectorManager, ConnectorScheduler } from './connector-manager.service';
import { DonationSourcesController } from './donation-sources.controller';
import { DonationSourcesService } from './donation-sources.service';
import { DonatePayApi } from './donatepay.api';
import { DonatePayConnector } from './donatepay.connector';
import { DonationAlertsApi } from './donationalerts.api';
import { DonationAlertsConnector } from './donationalerts.connector';
import { IntegrationsController } from './integrations.controller';
import { KickEventsConnector } from './kick-events.connector';
import { KickProvider } from './kick.provider';
import { KickWebhookController } from './kick-webhook.controller';
import { KickWebhookService } from './kick-webhook.service';
import { OAuthStateService } from './oauth-state.service';
import { PlatformConnectionService } from './platform-connection.service';
import { PlatformRegistry } from './platform-registry.service';
import { PlatformTokenService } from './platform-token.service';
import { TwitchEventSubConnector } from './twitch-eventsub.connector';
import { TwitchProvider } from './twitch.provider';
import { YouTubeProvider } from './youtube.provider';

/**
 * Площадки: OAuth-контур, хранение токенов, провайдеры метрик.
 *
 * Импортируется и API (подключение площадки), и воркером (сбор метрик).
 * Ничего долгоживущего не поднимает: все провайдеры здесь — про запрос-ответ.
 */
@Module({
  imports: [EventsModule, BillingModule],
  controllers: [IntegrationsController, DonationSourcesController, KickWebhookController],
  providers: [
    HttpClient,
    TwitchProvider,
    YouTubeProvider,
    KickProvider,
    KickWebhookService,
    PlatformRegistry,
    PlatformTokenService,
    OAuthStateService,
    PlatformConnectionService,
    DonationAlertsApi,
    DonatePayApi,
    DonationSourcesService,
  ],
  exports: [
    PlatformRegistry,
    PlatformTokenService,
    PlatformConnectionService,
    DonationAlertsApi,
    DonatePayApi,
    TwitchProvider,
    KickProvider,
  ],
})
export class IntegrationsModule {}

/**
 * Коннекторы донатов. Живут ТОЛЬКО в воркере.
 *
 * Отдельный модуль, а не часть `IntegrationsModule`, именно из-за этого: у
 * `ConnectorManager` есть `onApplicationBootstrap` и такт сверки, которые поднимают долгоживущие
 * websocket-соединения. Попади он в API, каждый деплой рвал бы источники
 * донатов у всех стримеров разом — и тем чаще, чем больше инстансов API.
 */
@Module({
  imports: [EventsModule, IntegrationsModule],
  providers: [
    DonationAlertsConnector,
    DonatePayConnector,
    TwitchEventSubConnector,
    KickEventsConnector,
    ConnectorManager,
    ConnectorScheduler,
  ],
  exports: [ConnectorManager],
})
export class DonationConnectorsModule {}
