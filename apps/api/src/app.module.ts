import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { AccessTokenGuard } from './common/auth/access-token.guard';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { REDIS_CLIENT, RedisModule } from './common/redis/redis.module';
import { AppConfig } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { AuthModule } from './modules/auth/auth.module';
import { EventsModule } from './modules/events/events.module';
import { HealthController } from './modules/health/health.controller';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { WidgetsModule } from './modules/widgets/widgets.module';

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
          // Ничего из перечисленного в логи попадать не должно ни при каких условиях.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-streamkit-signature"]',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.newPassword',
              'req.body.currentPassword',
              'req.body.totpCode',
            ],
            remove: true,
          },
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [AppConfig, REDIS_CLIENT],
      useFactory: (config: AppConfig, redis: Redis) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.throttleLimit },
          { name: 'auth', ttl: 60_000, limit: config.throttleAuthLimit },
        ],
        // Счётчики живут в Redis, а не в памяти процесса. В памяти каждый
        // инстанс API ведёт свой счёт, и жёсткий лимит на вход по факту
        // умножается на число реплик — причём незаметно: каждый инстанс
        // уверен, что лимит соблюдён.
        //
        // Передаём уже существующее соединение, а не URL: иначе пакет откроет
        // четвёртое и закроет его на своём onModuleDestroy вразнобой с нашим.
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),

    PrismaModule,
    RedisModule,
    CommonModule,

    AuthModule,
    WidgetsModule,
    EventsModule,
    RealtimeModule,
    PrivacyModule,
  ],
  controllers: [HealthController],
  providers: [
    // Порядок важен: сначала лимиты, потом аутентификация. Перебор паролей должен
    // упираться в throttler, не доходя до дорогой проверки argon2.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
  ],
})
export class AppModule {}
