import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config.service';
import { validateEnv } from './env';

/**
 * Окружение проверяется схемой при старте приложения: пустой секрет или
 * отсутствующий DATABASE_URL роняют процесс сразу, а не в момент первого запроса.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      cache: true,
      // В тестах конфигурация задаётся переменными процесса. Файл `.env`
      // игнорируется намеренно: ConfigModule отдаёт ему приоритет над
      // process.env, и тестовые значения молча перетирались бы боевыми.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
