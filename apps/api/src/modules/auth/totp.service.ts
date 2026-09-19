import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { toDataURL } from 'qrcode';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/**
 * Допуск на расхождение часов, в секундах.
 *
 * Тридцать секунд в обе стороны — это ровно один шаг TOTP, то же самое, что
 * задавал `window: 1` в otplib 12. Часы на телефоне почти всегда слегка
 * расходятся с сервером, а без допуска пользователь получает необъяснимые
 * отказы. Больше брать нельзя: каждый лишний шаг удваивает окно, в котором
 * подсмотренный код ещё сработает.
 */
const EPOCH_TOLERANCE_SECONDS = 30;

/**
 * Сколько помним использованный код. Код действует полторы минуты с допуском
 * часов — отметка живёт дольше окна его действия.
 */
const USED_CODE_TTL_SECONDS = 120;

/**
 * Второй фактор по TOTP (RFC 6238) — совместим с Google Authenticator, Aegis,
 * 1Password и прочими.
 *
 * В otplib 13 объект `authenticator` с изменяемыми настройками убрали: теперь
 * это чистые функции, которым параметры передаются на каждый вызов. Для нас это
 * к лучшему — общие настройки на весь процесс были общим изменяемым состоянием.
 */
@Injectable()
export class TotpService {
  private readonly issuer = 'StreamKit';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  generateSecret(): string {
    return generateSecret();
  }

  async buildQrDataUrl(accountEmail: string, secret: string): Promise<string> {
    return toDataURL(generateURI({ issuer: this.issuer, label: accountEmail, secret }));
  }

  verify(secret: string, code: string): boolean {
    try {
      return verifySync({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS }).valid;
    } catch {
      // Битый секрет или мусор вместо кода — это «не подошло», а не авария.
      return false;
    }
  }

  /**
   * Код для входа принимается один раз — в дашборд и в админку вместе.
   *
   * Иначе подсмотренный за плечом или перехваченный вместе с паролем код
   * открывал бы вторую сессию, пока не истекло его окно. Проверка и отметка —
   * одна команда: две параллельные попытки с одним кодом не пройдут обе.
   *
   * @returns false — код уже использовали.
   */
  async consume(userId: string, code: string): Promise<boolean> {
    const fresh = await this.redis.set(
      `auth:totp-used:${userId}:${code}`,
      '1',
      'EX',
      USED_CODE_TTL_SECONDS,
      'NX',
    );
    return fresh === 'OK';
  }
}
