import { Injectable, Logger } from '@nestjs/common';
import type { Platform } from '@streamkit/contracts';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PlatformAuthError } from '../../common/http/platform-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisLock } from '../../common/redis/lock.service';
import type { OAuthTokens } from './platform-provider';
import { PlatformRegistry } from './platform-registry.service';

/**
 * За сколько до истечения обновляем токен заранее.
 *
 * Не ноль: между проверкой срока и приходом запроса на площадку проходит
 * время, и токен, живущий «ещё секунду», приедет туда уже мёртвым.
 */
const REFRESH_MARGIN_MS = 120_000;

/** Сколько держим блокировку обновления. Обмен токена укладывается в секунды. */
const REFRESH_LOCK_TTL_MS = 30_000;

/**
 * Сколько ждём, пока чужое обновление токена закончится.
 *
 * Пять попыток по полсекунды — две с половиной секунды. Обмен токена у Google и
 * Twitch укладывается в сотни миллисекунд; таймаут HTTP-клиента — десять секунд,
 * но ждать столько незачем: если обмен затянулся, следующий тик опроса попробует
 * снова, а держать в это время пул соединений к БД не за чем.
 */
const REFRESH_WAIT_ATTEMPTS = 5;
const REFRESH_WAIT_STEP_MS = 500;

/**
 * Чьи учётные данные умеет хранить сервис.
 *
 * Шире, чем `Platform`: донат-площадки тоже кладут сюда OAuth-токены, хотя
 * провайдера метрик у них нет. Продлить их пока нечем — но и это лучше, чем
 * прежнее поведение, когда протухший токен молча уезжал в коннектор и источник
 * переставал работать без единого сообщения.
 */
export type CredentialProvider = Platform | 'donationalerts' | 'donatepay';

/**
 * Хранение и обновление OAuth-токенов площадок.
 *
 * Общий слой для аналитики и донат-коннекторов: и тем, и другим нужен живой
 * access-токен, и ни у тех, ни у других раньше не было кода, который его
 * продлевает — токен площадки просто умирал через час, а источник тихо
 * переставал работать.
 *
 * Обновление идёт под блокировкой Redis. Это не перестраховка: Google при
 * обмене refresh-токена в ряде сценариев выдаёт новый и гасит старый, поэтому
 * два параллельных обновления (опрос и запрос из дашборда в одну секунду)
 * взаимно убили бы друг друга и выкинули пользователя из интеграции.
 */
@Injectable()
export class PlatformTokenService {
  private readonly logger = new Logger(PlatformTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly lock: RedisLock,
    private readonly registry: PlatformRegistry,
    private readonly audit: AuditService,
  ) {}

  /**
   * Живой access-токен пользователя для площадки.
   *
   * @throws PlatformAuthError — учётных данных нет или обновить их не удалось.
   *         Вызывающий код обязан пометить канал как требующий переподключения,
   *         а не повторять запрос.
   */
  async getAccessToken(userId: string, platform: CredentialProvider): Promise<string> {
    const credential = await this.prisma.integrationCredential.findUnique({
      where: { userId_provider: { userId, provider: platform } },
    });

    if (!credential) {
      throw new PlatformAuthError(platform, 401, 'Площадка не подключена');
    }

    if (!this.isExpiring(credential.expiresAt)) {
      return this.crypto.decrypt(credential.accessTokenEncrypted);
    }

    if (!credential.refreshTokenEncrypted) {
      // Площадка не дала refresh-токен — продлить нечего, нужен повторный вход.
      throw new PlatformAuthError(platform, 401, 'Срок доступа истёк, требуется переподключение');
    }

    const refreshed = await this.lock.withLock(
      `streamkit:lock:oauth-refresh:${userId}:${platform}`,
      REFRESH_LOCK_TTL_MS,
      () => this.refresh(userId, platform, credential.refreshTokenEncrypted as string),
    );

    if (refreshed !== null) return refreshed;

    // Блокировку держит кто-то другой — и держит ВСЁ время обмена токена.
    // Значит обновление не «уже закончилось», а идёт прямо сейчас, и читать
    // запись немедленно бессмысленно: там ещё прежний срок. Раньше код читал
    // сразу и бросал PlatformAuthError, то есть здоровый канал уходил в
    // AUTH_EXPIRED — терминальное состояние с требованием переподключить
    // площадку. Достаточно было совпадения тика опроса и старта коннектора.
    return this.awaitRefreshedBy(userId, platform);
  }

  /** Сколько ждём чужое обновление, прежде чем признать доступ мёртвым. */
  private async awaitRefreshedBy(userId: string, platform: CredentialProvider): Promise<string> {
    for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt += 1) {
      await sleep(REFRESH_WAIT_STEP_MS);

      const fresh = await this.prisma.integrationCredential.findUnique({
        where: { userId_provider: { userId, provider: platform } },
      });
      if (!fresh) break;
      if (!this.isExpiring(fresh.expiresAt)) return this.crypto.decrypt(fresh.accessTokenEncrypted);
    }

    // Держатель блокировки не справился за отведённое время — либо обновление
    // действительно не получилось, либо процесс умер и блокировка ещё не истекла.
    throw new PlatformAuthError(platform, 401, 'Не удалось обновить доступ к площадке');
  }

  /** Сохраняет выданную площадкой пару. Наружу токены не отдаются никогда. */
  async save(userId: string, platform: CredentialProvider, tokens: OAuthTokens): Promise<void> {
    const encryptedRefresh = tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null;

    await this.prisma.integrationCredential.upsert({
      where: { userId_provider: { userId, provider: platform } },
      create: {
        userId,
        provider: platform,
        accessTokenEncrypted: this.crypto.encrypt(tokens.accessToken),
        refreshTokenEncrypted: encryptedRefresh,
        scopes: tokens.scopes,
        expiresAt: tokens.expiresAt,
      },
      update: {
        accessTokenEncrypted: this.crypto.encrypt(tokens.accessToken),
        // Отсутствие refresh в ответе означает «оставь прежний», а не «его
        // больше нет»: Google при обновлении обычно не присылает его повторно.
        ...(encryptedRefresh ? { refreshTokenEncrypted: encryptedRefresh } : {}),
        scopes: tokens.scopes,
        expiresAt: tokens.expiresAt,
      },
    });
  }

  async remove(userId: string, platform: CredentialProvider): Promise<void> {
    await this.prisma.integrationCredential.deleteMany({
      where: { userId, provider: platform },
    });
  }

  private async refresh(
    userId: string,
    platform: CredentialProvider,
    encryptedRefreshToken: string,
  ): Promise<string> {
    const provider = this.registry.find(platform as Platform);
    if (!provider) {
      // Донат-площадки: токен есть, провайдера для обновления нет. Честно
      // сообщаем, что доступ мёртв, вместо того чтобы отдать протухший токен.
      await this.audit.record('integration.token.expired', userId, { metadata: { platform } });
      throw new PlatformAuthError(platform, 401, 'Срок доступа истёк, требуется переподключение');
    }

    try {
      const tokens = await provider.refreshTokens(this.crypto.decrypt(encryptedRefreshToken));
      await this.save(userId, platform, tokens);
      this.logger.debug({ userId, platform }, 'Токен площадки обновлён');
      return tokens.accessToken;
    } catch (error) {
      await this.audit.record('integration.token.expired', userId, { metadata: { platform } });
      this.logger.warn({ err: error, userId, platform }, 'Не удалось обновить токен площадки');
      throw new PlatformAuthError(platform, 401, 'Не удалось обновить доступ к площадке');
    }
  }

  /** Токен без срока считаем вечным: так делает, например, DonationAlerts. */
  private isExpiring(expiresAt: Date | null): boolean {
    if (!expiresAt) return false;
    return expiresAt.getTime() - Date.now() <= REFRESH_MARGIN_MS;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
