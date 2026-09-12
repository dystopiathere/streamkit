import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config.service';
import { validateEnv } from './env';

/**
 * Где искать файл окружения.
 *
 * Файлов в проекте два, и это не дублирование: `apps/api/.env` нужен CLI
 * Prisma (он ищет его рядом со схемой и в текущем каталоге), а корневой —
 * docker compose. Приложение при этом запускается из `apps/api` и раньше
 * видело только первый.
 *
 * Из-за этого новая переменная, дописанная в корневой файл, молча не доезжала
 * до приложения: оно стартовало нормально, а функция просто не включалась.
 * Теперь читаются оба, ближний имеет приоритет; отсутствующий путь dotenv
 * пропускает, поэтому в контейнере, где корневого файла нет, ничего не меняется.
 */
const ENV_FILES = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '..', '.env')];

/**
 * Окружение проверяется схемой при старте приложения: пустой секрет или
 * отсутствующий DATABASE_URL роняют процесс сразу, а не в момент первого запроса.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ENV_FILES,
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
