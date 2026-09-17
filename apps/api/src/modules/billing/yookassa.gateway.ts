import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { minorToDecimalString, parseMajorToMinor } from '@streamkit/contracts';
import { z } from 'zod';
import { HttpClient } from '../../common/http/http-client.service';
import { PlatformError } from '../../common/http/platform-errors';
import { AppConfig } from '../../config/app-config.service';
import type {
  ChargeSavedRequest,
  CreatePaymentRequest,
  PaymentGateway,
  ProviderPayment,
} from './payment-gateway';

/** Сколько раз переспрашиваем, если ЮKassa ещё обрабатывает запрос с тем же ключом. */
const MAX_PROCESSING_POLLS = 3;
const MAX_PROCESSING_WAIT_MS = 5_000;

/**
 * Ответ ЮKassa о платеже. Разбирается схемой: это внешние данные, и сумма из
 * них решает, продлевать ли подписку.
 */
const paymentResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'waiting_for_capture', 'succeeded', 'canceled']),
  amount: z.object({ value: z.string(), currency: z.string().length(3) }),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  payment_method: z
    .object({
      id: z.string(),
      saved: z.boolean(),
      type: z.string(),
      title: z.string().nullish(),
      card: z.object({ last4: z.string().nullish() }).nullish(),
    })
    .nullish(),
  cancellation_details: z.object({ reason: z.string() }).nullish(),
  confirmation: z.object({ confirmation_url: z.string().url().nullish() }).nullish(),
});

/** Список возвратов по платежу. */
const refundListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      payment_id: z.string(),
      status: z.enum(['pending', 'succeeded', 'canceled']),
      amount: z.object({ value: z.string(), currency: z.string().length(3) }),
    }),
  ),
  next_cursor: z.string().nullish(),
});

const MAX_REFUND_PAGES = 10;

/**
 * Тело отказа ЮKassa: `{ type: "error", code, description, parameter }`.
 *
 * В журнал идут только эти три поля. Без них боевой отказ выглядел бы одним
 * «ответила 403», а у ЮKassa за этим кодом разные вещи: неверный ключ, не
 * подключённые автоплатежи (`save_payment_method`), чек без подключённой кассы.
 */
const yookassaErrorSchema = z.object({
  type: z.literal('error'),
  code: z.string().max(64).optional(),
  description: z.string().optional(),
  parameter: z.string().max(128).optional(),
});

export function describeYooKassaError(body: string): Record<string, string> | undefined {
  const parsed = yookassaErrorSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return undefined;
  const { code, description, parameter } = parsed.data;
  return {
    ...(code ? { code } : {}),
    ...(description ? { description: description.slice(0, 300) } : {}),
    ...(parameter ? { parameter } : {}),
  };
}

/** Ответ «запрос с этим ключом ещё обрабатывается» — HTTP 202. */
const processingSchema = z.object({ type: z.literal('processing'), retry_after: z.number() });

/**
 * Клиент ЮKassa (API v3).
 *
 * Три вещи здесь не очевидны и важны:
 * - `Idempotence-Key` у каждого POST — наш идентификатор платежа. `HttpClient`
 *   повторяет запрос на 5xx и обрыв сети, и без ключа повтор создал бы второй
 *   платёж и второе списание;
 * - сумма уходит строкой с двумя знаками (`"490.00"`), собранной из целых копеек;
 * - чек зависит от статуса продавца. У самозанятого его формирует ЮKassa, и `receipt` не передаётся вовсе. ИП и организация —
 *   чек 54-ФЗ по `receipt`, НДС и налоговый режим из окружения: это решение
 *   бухгалтерии, а не кода.
 */
@Injectable()
export class YooKassaGateway implements PaymentGateway {
  constructor(
    private readonly http: HttpClient,
    private readonly config: AppConfig,
  ) {}

  async createPayment(request: CreatePaymentRequest): Promise<ProviderPayment> {
    return this.post(request.paymentId, {
      ...this.common(request),
      confirmation: { type: 'redirect', return_url: request.returnUrl },
      // Способ оплаты сохраняется для продлений. Согласие на это стример дал
      // флажком при оплате, и оно записано в журнал до этого запроса.
      save_payment_method: true,
    });
  }

  async chargeSaved(request: ChargeSavedRequest): Promise<ProviderPayment> {
    return this.post(request.paymentId, {
      ...this.common(request),
      payment_method_id: request.paymentMethodId,
    });
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const settings = this.settings();
    const raw = await this.http.json<unknown>({
      platform: 'yookassa',
      describeError: describeYooKassaError,
      url: `${settings.apiUrl}/payments/${encodeURIComponent(providerPaymentId)}`,
      basicAuth: { username: settings.shopId, password: settings.secretKey },
    });
    return toProviderPayment(paymentResponseSchema.parse(raw));
  }

  async refundedAmount(
    providerPaymentId: string,
  ): Promise<{ amountMinor: number; currency: string }> {
    const settings = this.settings();
    let amountMinor = 0;
    let currency = 'RUB';
    let cursor: string | null = null;

    // Возвратов по одному платежу — единицы, но список ЮKassa постраничный, и
    // потерянная вторая страница занизила бы сумму возврата.
    for (let page = 0; page < MAX_REFUND_PAGES; page += 1) {
      const url = new URL(`${settings.apiUrl}/refunds`);
      url.searchParams.set('payment_id', providerPaymentId);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);

      const list = refundListSchema.parse(
        await this.http.json<unknown>({
          platform: 'yookassa',
          describeError: describeYooKassaError,
          url: url.toString(),
          basicAuth: { username: settings.shopId, password: settings.secretKey },
        }),
      );
      for (const refund of list.items) {
        if (refund.status !== 'succeeded' || refund.payment_id !== providerPaymentId) continue;
        const minor = parseMajorToMinor(refund.amount.value);
        if (minor === null) {
          throw new PlatformError(
            'yookassa',
            200,
            `Непонятная сумма возврата: ${refund.amount.value}`,
          );
        }
        amountMinor += minor;
        currency = refund.amount.currency;
      }
      cursor = list.next_cursor ?? null;
      if (!cursor) break;
    }
    return { amountMinor, currency };
  }

  private common(request: CreatePaymentRequest | ChargeSavedRequest): Record<string, unknown> {
    const settings = this.settings();
    const amount = { value: minorToDecimalString(request.amountMinor), currency: request.currency };
    return {
      amount,
      // Сразу списание, без двухстадийного холда: услуга оказывается сразу же.
      capture: true,
      description: request.description.slice(0, 128),
      metadata: { paymentId: request.paymentId },
      ...(settings.receipts === 'fiscal'
        ? {
            receipt: {
              customer: { email: request.customerEmail },
              items: [
                {
                  description: request.description.slice(0, 128),
                  quantity: '1.00',
                  amount,
                  vat_code: settings.vatCode,
                  payment_subject: 'service',
                  payment_mode: 'full_payment',
                },
              ],
              ...(settings.taxSystemCode ? { tax_system_code: settings.taxSystemCode } : {}),
            },
          }
        : {}),
    };
  }

  private async post(idempotenceKey: string, body: unknown): Promise<ProviderPayment> {
    const settings = this.settings();
    for (let poll = 0; ; poll += 1) {
      const raw = await this.http.json<unknown>({
        platform: 'yookassa',
        describeError: describeYooKassaError,
        url: `${settings.apiUrl}/payments`,
        method: 'POST',
        basicAuth: { username: settings.shopId, password: settings.secretKey },
        headers: { 'Idempotence-Key': idempotenceKey },
        json: body,
      });

      // ЮKassa ещё обрабатывает запрос с этим ключом. Повтор с тем же ключом
      // вернёт тот же платёж, а не создаст новый.
      const processing = processingSchema.safeParse(raw);
      if (processing.success) {
        if (poll + 1 >= MAX_PROCESSING_POLLS) {
          throw new PlatformError('yookassa', 202, 'ЮKassa не закончила обработку платежа');
        }
        await sleep(Math.min(processing.data.retry_after, MAX_PROCESSING_WAIT_MS));
        continue;
      }
      return toProviderPayment(paymentResponseSchema.parse(raw));
    }
  }

  private settings(): NonNullable<AppConfig['billing']> {
    const settings = this.config.billing;
    if (!settings) throw new ServiceUnavailableException('Оплата не настроена на этом сервере');
    return settings;
  }
}

export function toProviderPayment(raw: z.infer<typeof paymentResponseSchema>): ProviderPayment {
  const amountMinor = parseMajorToMinor(raw.amount.value);
  if (amountMinor === null) {
    throw new PlatformError('yookassa', 200, `Непонятная сумма в ответе: ${raw.amount.value}`);
  }
  const paymentId = raw.metadata?.paymentId;
  return {
    id: raw.id,
    status: raw.status,
    amountMinor,
    currency: raw.amount.currency,
    paymentId: typeof paymentId === 'string' ? paymentId : null,
    paymentMethod: raw.payment_method
      ? {
          id: raw.payment_method.id,
          saved: raw.payment_method.saved,
          title: paymentMethodTitle(raw.payment_method),
        }
      : null,
    cancellationReason: raw.cancellation_details?.reason ?? null,
    confirmationUrl: raw.confirmation?.confirmation_url ?? null,
  };
}

/** Подпись способа оплаты для интерфейса. Номер карты — только последние цифры. */
function paymentMethodTitle(method: {
  type: string;
  title?: string | null;
  card?: { last4?: string | null } | null;
}): string {
  if (method.type === 'bank_card' && method.card?.last4) return `Карта *${method.card.last4}`;
  if (method.type === 'sbp') return 'СБП';
  if (method.type === 'yoo_money') return 'ЮMoney';
  return (method.title ?? method.type).slice(0, 120);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
