import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ConnectorManager } from './connector-manager.service';
import { DonationAlertsConnector } from './donationalerts.connector';

/**
 * Коннекторы внешних площадок. Живут только в worker-процессе: держать
 * долгоживущие websocket-соединения в API-инстансе означало бы, что при каждом
 * рестарте по деплою у всех стримеров рвутся источники донатов.
 */
@Module({
  imports: [EventsModule],
  providers: [DonationAlertsConnector, ConnectorManager],
  exports: [ConnectorManager],
})
export class IntegrationsModule {}
