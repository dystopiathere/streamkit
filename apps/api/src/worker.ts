import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

/**
 * Точка входа фонового процесса.
 *
 * `createApplicationContext`, а не `create`: HTTP-сервер воркеру не нужен и
 * открывать порт наружу незачем.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  // Логгер обязан быть назначен, и это не косметика. `bufferLogs` копит записи
  // до назначения настоящего логгера — без этой строки воркер не печатал НИ
  // ОДНОЙ: ни «процесс запущен», ни ошибок сбора метрик, ни отказов площадок.
  // Снаружи это выглядит как исправно работающий молчаливый контейнер, и
  // разбирать по такому любую неполадку нечем.
  app.useLogger(app.get(PinoLogger));

  // Без этого SIGTERM от Docker убьёт процесс, не дав закрыть соединения с
  // площадками и не дождавшись завершения текущей обработки события.
  app.enableShutdownHooks();

  new Logger('Worker').log('Фоновый процесс запущен');
}

void bootstrap();
