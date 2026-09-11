import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Точка входа фонового процесса.
 *
 * `createApplicationContext`, а не `create`: HTTP-сервер воркеру не нужен и
 * открывать порт наружу незачем.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  // Без этого SIGTERM от Docker убьёт процесс, не дав закрыть соединения с
  // площадками и не дождавшись завершения текущей обработки события.
  app.enableShutdownHooks();

  new Logger('Worker').log('Фоновый процесс запущен');
}

void bootstrap();
