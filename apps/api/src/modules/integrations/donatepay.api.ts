import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HttpClient } from '../../common/http/http-client.service';
import { PlatformAuthError, PlatformError } from '../../common/http/platform-errors';
import { AppConfig } from '../../config/app-config.service';

/**
 * Ответ DonatePay всегда несёт `status`; при ошибке — `message`.
 *
 * Отвергнутый ключ приходит кодом 200 с `status: "error"`, а не 401: без
 * разбора тела мёртвый ключ выглядел бы как «донатов пока нет».
 */
const envelopeSchema = z.object({
  status: z.string(),
  message: z.string().nullish(),
});

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

export interface DonatePayProfile {
  id: string;
  /** Имя аккаунта для дашборда. Баланс из того же ответа не берём. */
  name: string;
}

/** Сколько последних донатов спрашиваем за раз — столько же по умолчанию отдаёт DonatePay. */
export const DONATEPAY_PAGE_SIZE = 25;

/**
 * HTTP-часть DonatePay: профиль и последние донаты по личному ключу API.
 *
 * OAuth для сторонних приложений у DonatePay нет: стример копирует ключ со
 * страницы API своего кабинета. Ключ передаётся параметром `access_token` —
 * так его принимает API; `HttpClient` адрес запроса в журнал не пишет.
 *
 * Лимит — один запрос к методу на ключ примерно в двадцать секунд (заголовки
 * `x-ratelimit-*` и 429 с `retry-after` у боевого API). Поэтому донаты
 * опрашиваются, а не спрашиваются по требованию, см. `DonatePayConnector`.
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
   * Последние донаты аккаунта, от новых к старым, в любом статусе.
   *
   * Статус не фильтруется запросом: донат, ожидавший оплаты, становится
   * успешным позже, и коннектору нужно видеть его в обоих состояниях.
   */
  async fetchRecentDonations(apiKey: string): Promise<DonatePayTransaction[]> {
    const raw = transactionsSchema.parse(
      await this.request('/api/v1/transactions', apiKey, {
        type: 'donation',
        order: 'DESC',
        limit: String(DONATEPAY_PAGE_SIZE),
      }),
    );
    return raw.data;
  }

  private async request(
    path: string,
    apiKey: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(`${this.config.donatePayBaseUrl}${path}`);
    url.searchParams.set('access_token', apiKey);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const body = await this.http.json<unknown>({ platform: 'donatepay', url: url.toString() });
    const envelope = envelopeSchema.safeParse(body);
    if (envelope.success && envelope.data.status !== 'success') {
      const message = envelope.data.message ?? '';
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
