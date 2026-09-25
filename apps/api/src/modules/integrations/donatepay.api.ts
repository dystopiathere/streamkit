import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HttpClient } from '../../common/http/http-client.service';
import {
  PlatformAuthError,
  PlatformError,
  PlatformRateLimitError,
} from '../../common/http/platform-errors';
import { AppConfig } from '../../config/app-config.service';

/**
 * Ответ DonatePay всегда несёт `status`; при ошибке — `message`.
 *
 * Отвергнутый ключ приходит кодом 200 с `status: "error"`, а не 401: без
 * разбора тела мёртвый ключ выглядел бы как «донатов пока нет».
 */
const envelopeSchema = z.object({
  status: z.union([z.string(), z.number()]),
  message: z.string().nullish(),
});

/**
 * Лимит в теле ответа. Документация описывает его как `status: 429` в
 * конверте, а боевой API отвечает кодом 429 с `retry-after` — ловим оба.
 */
const RATE_LIMIT_STATUS = '429';
const RATE_LIMIT_PAUSE_MS = 20_000;

/** Сообщения DonatePay о ключе, который не подходит (проверено запросами к боевому API). */
const REJECTED_KEY_MESSAGES = new Set(['Incorrect token', 'Empty token']);

const userSchema = z.object({
  data: z.object({
    id: z.union([z.number(), z.string()]),
    name: z.string().nullish(),
  }),
});

/**
 * Время в ответе DonatePay. В клиентах их API оно приходит сериализованным
 * `DateTime` PHP (`{ date, timezone_type, timezone }`); строку принимаем тоже,
 * чтобы смена формата не роняла разбор всей страницы.
 */
const timeSchema = z.union([
  z.string(),
  z.object({ date: z.string(), timezone: z.string().nullish() }),
]);

const transactionSchema = z.object({
  id: z.union([z.number(), z.string()]),
  /** Имя донатера по документации; `vars.name` — то же имя в клиентах их API. */
  what: z.string().nullish(),
  type: z.string().nullish(),
  status: z.string().nullish(),
  sum: z.union([z.number(), z.string()]),
  /** В известном формате ответа поля валюты нет: счёт DonatePay.ru рублёвый. */
  currency: z.string().nullish(),
  comment: z.string().nullish(),
  vars: z.object({ name: z.string().nullish(), comment: z.string().nullish() }).nullish(),
  created_at: timeSchema.nullish(),
});
export type DonatePayTransaction = z.infer<typeof transactionSchema>;

const transactionsSchema = z.object({ data: z.array(transactionSchema) });

const socketTokenSchema = z.object({ token: z.string().min(1) });

const subscribeSchema = z.object({
  channels: z.array(z.object({ channel: z.string(), token: z.string().min(1) })),
});

export interface DonatePayProfile {
  id: string;
  /** Имя аккаунта для дашборда. Баланс из того же ответа не берём. */
  name: string;
}

/** Сколько донатов спрашиваем за раз — максимум, который отдаёт DonatePay. */
export const DONATEPAY_PAGE_SIZE = 100;

/** Путь токенов сокета: и подключения, и подписки на канал — по документации DonatePay. */
const SOCKET_TOKEN_PATH = '/api/v2/socket/token';

/**
 * HTTP-часть DonatePay: профиль, донаты и токены сокета по личному ключу API.
 *
 * OAuth для сторонних приложений у DonatePay нет: стример копирует ключ со
 * страницы API своего кабинета. Ключ передаётся параметром `access_token` —
 * так его принимает API; `HttpClient` адрес запроса в журнал не пишет.
 *
 * Лимит методов `v1` — один запрос к методу на ключ примерно в двадцать секунд
 * (заголовки `x-ratelimit-*` и 429 с `retry-after` у боевого API). У токенов
 * сокета (`v2`) заголовков лимита нет.
 */
@Injectable()
export class DonatePayApi {
  constructor(
    private readonly http: HttpClient,
    private readonly config: AppConfig,
  ) {}

  /**
   * Владелец ключа. Им же проверяется ключ при подключении.
   *
   * @throws PlatformAuthError — DonatePay ключ не принял.
   * @throws PlatformRateLimitError — ключ спрашивали слишком часто.
   */
  async fetchProfile(apiKey: string): Promise<DonatePayProfile> {
    const raw = userSchema.parse(await this.request('/api/v1/user', apiKey, {}));
    return {
      id: String(raw.data.id),
      name: raw.data.name?.trim() || String(raw.data.id),
    };
  }

  /**
   * Самый новый донат аккаунта — точка отсчёта при первом подключении.
   *
   * @returns `null`, если донатов ещё не было.
   */
  async fetchLatestDonation(apiKey: string): Promise<DonatePayTransaction | null> {
    const raw = transactionsSchema.parse(
      await this.request('/api/v1/transactions', apiKey, {
        type: 'donation',
        order: 'DESC',
        limit: '1',
      }),
    );
    return raw.data[0] ?? null;
  }

  /**
   * Донаты после `afterId`, от старых к новым, в любом статусе.
   *
   * Спрашиваем «после курсора», а не «последние N»: при наплыве донатов между
   * опросами страница последних обрезала бы середину. Статус запросом не
   * фильтруется: донат, ожидавший оплаты, становится успешным позже, и
   * коннектору нужно видеть его в обоих состояниях.
   */
  async fetchDonationsAfter(apiKey: string, afterId: number): Promise<DonatePayTransaction[]> {
    const raw = transactionsSchema.parse(
      await this.request('/api/v1/transactions', apiKey, {
        type: 'donation',
        order: 'ASC',
        after: String(afterId),
        limit: String(DONATEPAY_PAGE_SIZE),
      }),
    );
    return raw.data;
  }

  /** Токен подключения к сокету Centrifugo. */
  async socketToken(apiKey: string): Promise<string> {
    const raw = socketTokenSchema.parse(
      await this.parse(
        await this.http.json<unknown>({
          platform: 'donatepay',
          url: `${this.config.donatePay.baseUrl}${SOCKET_TOKEN_PATH}`,
          method: 'POST',
          json: { access_token: apiKey },
        }),
      ),
    );
    return raw.token;
  }

  /**
   * Токен подписки на приватный канал под идентификатор клиента сокета.
   *
   * Так его запрашивает centrifuge-js 2.x из примера DonatePay: ключ —
   * параметром адреса (`subscribeParams`), клиент и каналы — телом.
   */
  async subscribeToken(apiKey: string, client: string, channel: string): Promise<string> {
    const url = new URL(`${this.config.donatePay.baseUrl}${SOCKET_TOKEN_PATH}`);
    url.searchParams.set('access_token', apiKey);
    const raw = subscribeSchema.parse(
      await this.parse(
        await this.http.json<unknown>({
          platform: 'donatepay',
          url: url.toString(),
          method: 'POST',
          json: { client, channels: [channel] },
        }),
      ),
    );
    const match = raw.channels.find((entry) => entry.channel === channel);
    if (!match) throw new Error('DonatePay не выдал токен канала донатов');
    return match.token;
  }

  get socketUrl(): string {
    return this.config.donatePay.socketUrl;
  }

  private async request(
    path: string,
    apiKey: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(`${this.config.donatePay.baseUrl}${path}`);
    url.searchParams.set('access_token', apiKey);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    return this.parse(
      await this.http.json<unknown>({ platform: 'donatepay', url: url.toString() }),
    );
  }

  /**
   * Разбирает конверт ответа.
   *
   * @throws PlatformAuthError — ключ не принят.
   * @throws PlatformRateLimitError — лимит в теле ответа.
   * @throws PlatformError — любая другая ошибка в конверте.
   */
  private parse(body: unknown): unknown {
    const envelope = envelopeSchema.safeParse(body);
    // У токена сокета конверта нет: успешный ответ — просто `{ token }`.
    if (envelope.success && String(envelope.data.status) !== 'success') {
      const message = envelope.data.message ?? '';
      if (String(envelope.data.status) === RATE_LIMIT_STATUS) {
        throw new PlatformRateLimitError(
          'donatepay',
          429,
          'DonatePay просит спрашивать реже',
          RATE_LIMIT_PAUSE_MS,
        );
      }
      if (REJECTED_KEY_MESSAGES.has(message)) {
        throw new PlatformAuthError('donatepay', 401, 'DonatePay не принял ключ API');
      }
      throw new PlatformError(
        'donatepay',
        200,
        `DonatePay ответил ошибкой: ${message.slice(0, 100)}`,
      );
    }
    return body;
  }
}
