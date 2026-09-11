import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';

/**
 * Второй фактор по TOTP (RFC 6238) — совместим с Google Authenticator, Aegis,
 * 1Password и прочими.
 *
 * `window: 1` даёт допуск ±30 секунд: часы на телефоне почти всегда слегка
 * расходятся с сервером, а без допуска пользователь получает необъяснимые отказы.
 */
@Injectable()
export class TotpService {
  private readonly issuer = 'StreamKit';

  constructor() {
    authenticator.options = { window: 1 };
  }

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  /** otpauth://-ссылка для QR-кода. */
  buildUri(accountEmail: string, secret: string): string {
    return authenticator.keyuri(accountEmail, this.issuer, secret);
  }

  async buildQrDataUrl(accountEmail: string, secret: string): Promise<string> {
    return toDataURL(this.buildUri(accountEmail, secret));
  }

  verify(secret: string, code: string): boolean {
    try {
      return authenticator.verify({ token: code, secret });
    } catch {
      return false;
    }
  }
}
