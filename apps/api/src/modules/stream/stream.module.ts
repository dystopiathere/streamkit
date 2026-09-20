import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';

// AnalyticsModule — ради опроса площадок по кнопке «Обновить». Обратной
// зависимости нет: аналитика про окно эфира ничего не знает.
@Module({
  imports: [AnalyticsModule],
  controllers: [StreamController],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}
