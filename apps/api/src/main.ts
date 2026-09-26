import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { registerBodyParsers } from './common/http/body-parsers';
import { AppConfig } from './config/app-config.service';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Сырое тело нужно для проверки HMAC входящих вебхуков: подпись считается по
    // байтам запроса, а не по результату JSON.parse.
    rawBody: true,
  });

  registerBodyParsers(app);
  const config = app.get(AppConfig);

  app.useLogger(app.get(PinoLogger));
  app.setGlobalPrefix('api');

  // За балансировщиком реальный IP приходит в X-Forwarded-For. Без этого все
  // клиенты выглядят одним адресом, и rate limit защищает не от того.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // API отдаёт только JSON, CSP для него смысла не имеет — она задаётся на фронте.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const ioAdapter = new RedisIoAdapter(app);
  await ioAdapter.connectToRedis(config.redisUrl, config.socketAdmission);
  app.useWebSocketAdapter(ioAdapter);

  // Корректное завершение: Nest дождётся onApplicationShutdown, закроются пулы
  // Postgres и Redis, и контейнер не будет убит по таймауту.
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');

  const bootstrapLogger = new Logger('Bootstrap');
  bootstrapLogger.log(`API запущен на порту ${config.port} (${config.nodeEnv})`);
  // Без магазина ЮKassa приватные комнаты бесплатны. В разработке так и надо, а
  // в боевом окружении это забытая переменная, которую иначе заметят только по
  // выручке.
  if (config.nodeEnv === 'production' && !config.billing) {
    bootstrapLogger.warn('Оплата подписки не настроена: приватные комнаты доступны бесплатно');
  }
  // Приём оплаты без реквизитов продавца на сайте — это и отказ модерации
  // ЮKassa, и нарушение закона о защите прав потребителей.
  const seller = config.seller;
  if (config.billing && (!seller.name || !seller.inn || !seller.email)) {
    bootstrapLogger.warn('Оплата настроена, а реквизиты продавца (SELLER_*) заполнены не все');
  }
}

void bootstrap();
