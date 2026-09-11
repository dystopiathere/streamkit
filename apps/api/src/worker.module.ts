import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AppConfig } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { AuthModule } from './modules/auth/auth.module';
import { EventsModule } from './modules/events/events.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';

/**
 * Фоновый процесс.
 *
 * Это отдельный процесс того же приложения, а не отдельный пакет. Причина
 * простая: воркеру нужны ровно те же доменные сервисы (приём событий,
 * дедупликация, шифрование токенов), и вынос их в третий пакет дал бы
 * дублирование или искусственный слой ради структуры папок.
 *
 * Контроллеры сюда не попадают: HTTP воркер не слушает, снаружи он недоступен.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          transport:
            config.nodeEnv === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    ScheduleModule.forRoot(),

    PrismaModule,
    RedisModule,
    CommonModule,

    AuthModule,
    EventsModule,
    IntegrationsModule,
    MaintenanceModule,
  ],
})
export class WorkerModule {}
