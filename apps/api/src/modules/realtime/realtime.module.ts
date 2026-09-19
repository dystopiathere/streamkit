import { Module } from '@nestjs/common';
import { StreamModule } from '../stream/stream.module';
import { WidgetsModule } from '../widgets/widgets.module';
import { DashboardGateway } from './dashboard.gateway';
import { OverlayGateway } from './overlay.gateway';

/**
 * Зависимость идёт в одну сторону: realtime знает про виджеты, виджеты про
 * realtime не знают — они публикуют изменения в RealtimeBus (глобальный модуль).
 * Так модули не образуют цикл, и `forwardRef` не нужен нигде.
 */
@Module({
  imports: [WidgetsModule, StreamModule],
  providers: [OverlayGateway, DashboardGateway],
})
export class RealtimeModule {}
