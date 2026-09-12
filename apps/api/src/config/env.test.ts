import { describe, expect, it } from 'vitest';
import { validateEnv } from './env';

/** Минимально достаточное окружение — то, без чего приложение не имеет смысла. */
const BASE = {
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/db?schema=public',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: 'секрет-длиной-заведомо-больше-32-символов',
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  IP_HASH_PEPPER: 'перец-для-ip-16plus',
  TOKEN_HASH_PEPPER: 'перец-для-токенов-16plus',
  CORS_ORIGINS: 'http://localhost:5173',
  OVERLAY_BASE_URL: 'http://localhost:5174',
};

describe('проверка окружения', () => {
  it('принимает минимальный набор', () => {
    expect(() => validateEnv({ ...BASE })).not.toThrow();
  });

  it('пустая строка в необязательной переменной означает «не задано»', () => {
    // Так выглядит .env, скопированный из .env.example: ключи площадок стоят
    // пустыми. Раньше это роняло приложение целиком — вместо того чтобы просто
    // не предлагать ненастроенную площадку.
    const env = validateEnv({
      ...BASE,
      TWITCH_CLIENT_ID: '',
      TWITCH_CLIENT_SECRET: '',
      COOKIE_DOMAIN: '',
    });

    expect(env.TWITCH_CLIENT_ID).toBeUndefined();
    expect(env.COOKIE_DOMAIN).toBeUndefined();
  });

  it('срезает пробелы: секрет, скопированный с хвостовым пробелом, не сходится молча', () => {
    const env = validateEnv({ ...BASE, YOUTUBE_CLIENT_SECRET: '  GOCSPX-значение  ' });
    expect(env.YOUTUBE_CLIENT_SECRET).toBe('GOCSPX-значение');
  });

  it('переменная из одних пробелов тоже считается незаданной', () => {
    expect(validateEnv({ ...BASE, YOUTUBE_CLIENT_ID: '   ' }).YOUTUBE_CLIENT_ID).toBeUndefined();
  });

  it('обязательные переменные пустыми не принимаются', () => {
    expect(() => validateEnv({ ...BASE, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
  });

  it('перечисляет в ошибке все проблемы разом, а не первую', () => {
    // Иначе окружение чинится по одной переменной за перезапуск.
    let message = '';
    try {
      validateEnv({ ...BASE, JWT_SECRET: 'коротко', IP_HASH_PEPPER: 'мало' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('IP_HASH_PEPPER');
  });

  it('подставляет значения по умолчанию для площадочных настроек', () => {
    const env = validateEnv({ ...BASE });
    expect(env.YOUTUBE_DAILY_QUOTA).toBe(9000);
    expect(env.WEB_BASE_URL).toBe('http://localhost:5173');
  });
});
