import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { toDataURL } from 'qrcode';

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

  generateSecret(): string {
    return generateSecret();
  }

  /** otpauth://-ссылка для QR-кода. */
  buildUri(accountEmail: string, secret: string): string {
    return generateURI({ issuer: this.issuer, label: accountEmail, secret });
  }

  async buildQrDataUrl(accountEmail: string, secret: string): Promise<string> {
    return toDataURL(this.buildUri(accountEmail, secret));
  }

  verify(secret: string, code: string): boolean {
    try {
      return verifySync({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS }).valid;
    } catch {
      // Битый секрет или мусор вместо кода — это «не подошло», а не авария.
      return false;
    }
  }
}
