import { describe, expect, it } from 'vitest';
import type { HttpClient, PlatformRequest } from '../../common/http/http-client.service';
import type { AppConfig } from '../../config/app-config.service';
import { YooKassaGateway } from './yookassa.gateway';

const config = {
  billing: {
    shopId: 'shop-1',
    secretKey: 'secret-1',
    apiUrl: 'https://yookassa.test/v3',
    receipts: 'fiscal',
    vatCode: 1,
    taxSystemCode: 2,
  },
} as AppConfig;

/** Самозанятый: чек формирует ЮKassa через «Мой налог», а не касса по `receipt`. */
const selfEmployed = { billing: { ...config.billing!, receipts: 'none' } } as AppConfig;

const PAYMENT = {
  id: 'yk-1',
  status: 'pending',
  amount: { value: '490.00', currency: 'RUB' },
  metadata: { paymentId: 'our-1' },
  confirmation: { type: 'redirect', confirmation_url: 'https://yookassa.test/pay/yk-1' },
};

/** HTTP-клиент, который запоминает запросы и отвечает заготовками по очереди. */
function recordingClient(...responses: unknown[]) {
  const requests: PlatformRequest[] = [];
  const http = {
    json: async (request: PlatformRequest) => {
      requests.push(request);
      return responses.shift();
    },
  } as unknown as HttpClient;
  return { http, requests };
}

const base = {
  paymentId: 'our-1',
  amountMinor: 49_000,
  currency: 'RUB',
  description: 'Подписка StreamKit «Про» на 1 месяц',
  customerEmail: 'streamer@example.com',
};

describe('клиент ЮKassa', () => {
  it('первый платёж: ключ идемпотентности, чек, сохранение способа оплаты', async () => {
    const { http, requests } = recordingClient(PAYMENT);
    const payment = await new YooKassaGateway(http, config).createPayment({
      ...base,
      returnUrl: 'https://app.example/billing?payment=our-1',
    });

    const [sent] = requests;
    // Без ключа повтор на 5xx создал бы второй платёж.
    expect(sent!.headers).toEqual({ 'Idempotence-Key': 'our-1' });
    expect(sent!.basicAuth).toEqual({ username: 'shop-1', password: 'secret-1' });
    expect(sent!.method).toBe('POST');
    expect(sent!.json).toMatchObject({
      amount: { value: '490.00', currency: 'RUB' },
      capture: true,
      save_payment_method: true,
      confirmation: { type: 'redirect', return_url: 'https://app.example/billing?payment=our-1' },
      metadata: { paymentId: 'our-1' },
      receipt: {
        customer: { email: 'streamer@example.com' },
        tax_system_code: 2,
        items: [
          {
            amount: { value: '490.00', currency: 'RUB' },
            vat_code: 1,
            payment_subject: 'service',
            payment_mode: 'full_payment',
          },
        ],
      },
    });
    expect(payment).toMatchObject({
      id: 'yk-1',
      amountMinor: 49_000,
      paymentId: 'our-1',
      confirmationUrl: 'https://yookassa.test/pay/yk-1',
    });
  });

  it('у самозанятого чек 54-ФЗ не передаётся', async () => {
    // Без подключённых «Чеков от ЮKassa» платёж с `receipt` отклоняется, а
    // у самозанятого кассы нет — чек формирует интеграция ЮKassa с «Мой налог».
    const { http, requests } = recordingClient(PAYMENT);
    await new YooKassaGateway(http, selfEmployed).createPayment({
      ...base,
      returnUrl: 'https://app.example/billing?payment=our-1',
    });
    expect(requests[0]!.json).not.toHaveProperty('receipt');
    expect(requests[0]!.json).toMatchObject({ save_payment_method: true });
  });

  it('продление списывает по сохранённому способу, без страницы оплаты', async () => {
    const { http, requests } = recordingClient({
      ...PAYMENT,
      status: 'succeeded',
      confirmation: null,
      payment_method: {
        id: 'pm-1',
        saved: true,
        type: 'bank_card',
        card: { last4: '4444' },
      },
    });
    const payment = await new YooKassaGateway(http, config).chargeSaved({
      ...base,
      paymentMethodId: 'pm-1',
    });

    expect(requests[0]!.json).toMatchObject({ payment_method_id: 'pm-1' });
    expect(requests[0]!.json).not.toHaveProperty('confirmation');
    expect(payment.paymentMethod).toEqual({ id: 'pm-1', saved: true, title: 'Карта *4444' });
  });

  it('«ещё обрабатывается» переспрашивает с тем же ключом, а не создаёт новый платёж', async () => {
    const { http, requests } = recordingClient(
      { type: 'processing', retry_after: 1 },
      { ...PAYMENT, status: 'succeeded' },
    );
    const payment = await new YooKassaGateway(http, config).chargeSaved({
      ...base,
      paymentMethodId: 'pm-1',
    });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.headers?.['Idempotence-Key'])).toEqual([
      'our-1',
      'our-1',
    ]);
    expect(payment.status).toBe('succeeded');
  });

  it('отмена приносит причину отказа банка', async () => {
    const { http } = recordingClient({
      ...PAYMENT,
      status: 'canceled',
      cancellation_details: { party: 'yoo_money', reason: 'permission_revoked' },
    });
    const payment = await new YooKassaGateway(http, config).getPayment('yk-1');
    expect(payment).toMatchObject({ status: 'canceled', cancellationReason: 'permission_revoked' });
  });

  it('сумма возвратов — итог успешных возвратов по всем страницам списка', async () => {
    const refund = (id: string, status: string, value: string) => ({
      id,
      payment_id: 'yk-1',
      status,
      amount: { value, currency: 'RUB' },
    });
    const { http, requests } = recordingClient(
      {
        items: [refund('r1', 'succeeded', '100.50'), refund('r2', 'canceled', '50.00')],
        next_cursor: 'c2',
      },
      { items: [refund('r3', 'succeeded', '30.00'), refund('r4', 'pending', '10.00')] },
    );

    const total = await new YooKassaGateway(http, config).refundedAmount('yk-1');

    expect(total).toEqual({ amountMinor: 13_050, currency: 'RUB' });
    expect(requests[0]!.url).toBe('https://yookassa.test/v3/refunds?payment_id=yk-1&limit=100');
    expect(requests[1]!.url).toContain('cursor=c2');
  });
});

describe('уведомления ЮKassa и лимиты запросов', () => {
  it('не ограничены ни одним лимитером', async () => {
    // Урок вебхука LiveKit: `@SkipThrottle()` без аргументов снимает только
    // `default`, и жёсткий `auth` отвечал бы 429 на одиннадцатое уведомление.
    const { YooKassaWebhookController } = await import('./billing.controller');
    for (const throttler of ['default', 'auth']) {
      expect(Reflect.getMetadata(`THROTTLER:SKIP${throttler}`, YooKassaWebhookController)).toBe(
        true,
      );
    }
  });
});
