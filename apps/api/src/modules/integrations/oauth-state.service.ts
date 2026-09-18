import { Inject, Injectable } from '@nestjs/common';
import type { DonationService, Platform } from '@streamkit/contracts';
import type { Redis } from 'ioredis';
import { CryptoService } from '../../common/crypto/crypto.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/**
 * Сколько живёт state. Десяти минут хватает, чтобы пройти вход на площадке и
 * подтвердить права; дольше — это уже брошенная вкладка.
 */
const STATE_TTL_SECONDS = 600;

/** Куда ведёт подключение: площадка аналитики или донат-сервис. */
export type OAuthTarget = Platform | DonationService;

export interface OAuthState {
  userId: string;
  platform: OAuthTarget;
}

/**
 * Одноразовый `state` для OAuth.
 *
 * Единственное, что аутентифицирует callback. Браузер приходит на него по
 * редиректу с чужого домена и без заголовка авторизации — access-токен туда
 * попасть не может в принципе. Поэтому state обязан быть:
 *
 *  - непредсказуемым (32 случайных байта, не идентификатор пользователя);
 *  - привязанным к конкретному пользователю на стороне сервера;
 *  - одноразовым — иначе перехваченная ссылка callback'а срабатывает повторно.
 *
 * В Redis лежит хэш, а не сам state: значение приезжает в query-строке и
 * попадает в логи прокси, и дамп Redis не должен давать готовый ключ.
 */
@Injectable()
export class OAuthStateService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly crypto: CryptoService,
  ) {}

  async issue(userId: string, platform: OAuthTarget): Promise<string> {
    const state = this.crypto.generateToken(32);
    await this.redis.set(
      this.key(state),
      JSON.stringify({ userId, platform } satisfies OAuthState),
      'EX',
      STATE_TTL_SECONDS,
    );
    return state;
  }

  /**
   * Забирает state и сразу удаляет его.
   *
   * `GETDEL` — одна операция: прочитать и удалить двумя командами значит
   * оставить окно, в котором один и тот же state принимается дважды.
   */
  async consume(state: string, platform: OAuthTarget): Promise<OAuthState | null> {
    if (!state) return null;

    const raw = await this.redis.getdel(this.key(state));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as OAuthState;
    // Площадка в ссылке и площадка в state обязаны совпадать: иначе код,
    // выданный одной площадкой, можно попробовать обменять у другой.
    if (parsed.platform !== platform) return null;

    return parsed;
  }

  /**
   * State из адреса возврата — только если его вернул тот же браузер.
   *
   * Иначе чужой state, подсунутый ссылкой, подключил бы аккаунт жертвы к
   * аккаунту того, кто этот state выпустил. Сверка ДО расходования: подсунутая
   * ссылка не должна сжигать state настоящего владельца.
   */
  async consumeFromBrowser(
    rawState: string,
    browserState: string | undefined,
    platform: OAuthTarget,
  ): Promise<{ state: OAuthState | null; boundToBrowser: boolean }> {
    const boundToBrowser =
      browserState !== undefined && this.crypto.safeCompare(browserState, rawState);
    return {
      state: boundToBrowser ? await this.consume(rawState, platform) : null,
      boundToBrowser,
    };
  }

  private key(state: string): string {
    return `streamkit:oauth:state:${this.crypto.hashToken(state)}`;
  }
}
