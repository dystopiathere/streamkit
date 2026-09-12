import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
/** Префикс версии формата: позволит сменить алгоритм без гадания о старых записях. */
const FORMAT_PREFIX = 'v1.';

/**
 * Шифрование полей БД и хэширование токенов.
 *
 * Разделение ответственности намеренное:
 *  - `encrypt/decrypt` — для данных, которые нужно уметь прочитать обратно
 *    (OAuth-токены площадок, TOTP-секрет, секрет вебхука);
 *  - `hashToken` — для наших собственных токенов: они генерируются нами, имеют
 *    256 бит энтропии, и медленный KDF тут не нужен — sha256 достаточно;
 *  - пароли пользователей здесь НЕ обрабатываются, для них argon2id в PasswordService.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly ipPepper: string;
  private readonly tokenPepper: string;

  constructor(config: AppConfig) {
    this.key = config.encryptionKey;
    this.ipPepper = config.ipHashPepper;
    this.tokenPepper = config.tokenHashPepper;
  }

  /** Возвращает строку вида `v1.<base64(iv|ciphertext|tag)>`. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return FORMAT_PREFIX + Buffer.concat([iv, ciphertext, tag]).toString('base64');
  }

  decrypt(payload: string): string {
    if (!payload.startsWith(FORMAT_PREFIX)) {
      throw new Error('Неизвестный формат шифротекста');
    }
    const raw = Buffer.from(payload.slice(FORMAT_PREFIX.length), 'base64');
    if (raw.length <= IV_LENGTH + TAG_LENGTH) {
      throw new Error('Повреждённый шифротекст');
    }
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(raw.length - TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH, raw.length - TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Криптостойкий токен в url-safe base64. 32 байта энтропии. */
  generateToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /**
   * Хэш для хранения наших токенов в БД. Детерминированный — по нему ищем запись.
   *
   * Ключ здесь СВОЙ, а не ключ шифрования. Раньше был общий, и это тихо
   * связывало две независимые операции: ротация ENCRYPTION_KEY (штатная
   * процедура, о которой думаешь как о перешифровке TOTP-секретов) заодно
   * меняла все tokenHash — то есть разлогинивала всех и обрывала все ссылки
   * оверлеев у всех стримеров одновременно.
   */
  hashToken(token: string): string {
    return createHmac('sha256', this.tokenPepper).update(token).digest('hex');
  }

  /**
   * Псевдонимизация IP. В логах и БД хранится хэш: для разбора инцидентов
   * («тот же адрес или другой») этого достаточно, а объём ПДн меньше.
   */
  hashIp(ip: string | undefined | null): string | null {
    if (!ip) return null;
    return createHmac('sha256', this.ipPepper).update(ip).digest('hex').slice(0, 32);
  }

  /** Сравнение секретов за постоянное время. Длины сравниваются заранее и безопасно. */
  safeCompare(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }

  /** HMAC-SHA256 в hex — для проверки подписи входящих вебхуков. */
  hmacHex(secret: string, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }
}
