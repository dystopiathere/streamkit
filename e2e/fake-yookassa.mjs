// Фальшивая ЮKassa для сквозного прогона.
//
// Настоящий тестовый магазин требует доступа к api.yookassa.ru и уведомлений на
// публичный адрес — ни того, ни другого у раннера CI нет. Здесь ровно то, что
// платформа использует: создание платежа, списание по сохранённому способу,
// статус и страница подтверждения, которая «оплачивает», шлёт уведомление и
// возвращает браузер на return_url, как это делает ЮKassa.
//
// Поведение, важное для денег, повторено: без Basic-авторизации — 401, без
// ключа идемпотентности — 400, повтор с тем же ключом — тот же платёж.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_YOOKASSA_PORT ?? 3099);
const WEBHOOK_URL =
  process.env.FAKE_YOOKASSA_WEBHOOK_URL ?? 'http://localhost:3000/api/billing/yookassa/webhook';

/** @type {Map<string, any>} */
const payments = new Map();
/** @type {Map<string, string>} ключ идемпотентности → id платежа */
const byKey = new Map();

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function notify(payment) {
  const event = payment.status === 'succeeded' ? 'payment.succeeded' : 'payment.canceled';
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'notification', event, object: publicView(payment) }),
    });
  } catch (error) {
    console.error('Уведомление не доставлено', error);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') return send(response, 200, { ok: true });

  // Страница оплаты: «стример ввёл карту». ?decline=1 — банк отказал.
  const confirm = /^\/confirm\/([\w-]+)$/.exec(url.pathname);
  if (confirm && request.method === 'GET') {
    const payment = payments.get(confirm[1]);
    if (!payment) return send(response, 404, { type: 'error', code: 'not_found' });
    if (url.searchParams.get('decline')) {
      Object.assign(payment, {
        status: 'canceled',
        cancellation_details: { party: 'payment_network', reason: 'insufficient_funds' },
      });
    } else {
      Object.assign(payment, {
        status: 'succeeded',
        paid: true,
        payment_method: {
          type: 'bank_card',
          id: `pm-${payment.id}`,
          saved: true,
          card: { last4: '4444', card_type: 'Visa' },
        },
      });
    }
    await notify(payment);
    response.writeHead(302, { Location: payment.return_url });
    return response.end();
  }

  if (!url.pathname.startsWith('/v3/payments')) return send(response, 404, {});
  if (!request.headers.authorization?.startsWith('Basic ')) {
    return send(response, 401, { type: 'error', code: 'invalid_credentials' });
  }

  if (url.pathname === '/v3/payments' && request.method === 'POST') {
    const key = request.headers['idempotence-key'];
    if (!key) return send(response, 400, { type: 'error', code: 'invalid_request' });
    const existing = byKey.get(String(key));
    if (existing) return send(response, 200, publicView(payments.get(existing)));

    const body = await readJson(request);
    const id = randomUUID();
    const charged = Boolean(body.payment_method_id);
    const payment = {
      id,
      status: charged ? 'succeeded' : 'pending',
      paid: charged,
      amount: body.amount,
      description: body.description,
      metadata: body.metadata,
      created_at: new Date().toISOString(),
      return_url: body.confirmation?.return_url,
      payment_method: charged
        ? { type: 'bank_card', id: body.payment_method_id, saved: true, card: { last4: '4444' } }
        : null,
      confirmation: charged
        ? null
        : { type: 'redirect', confirmation_url: `http://127.0.0.1:${PORT}/confirm/${id}` },
    };
    payments.set(id, payment);
    byKey.set(String(key), id);
    return send(response, 200, publicView(payment));
  }

  const get = /^\/v3\/payments\/([\w-]+)$/.exec(url.pathname);
  if (get && request.method === 'GET') {
    const payment = payments.get(get[1]);
    return payment
      ? send(response, 200, publicView(payment))
      : send(response, 404, { type: 'error', code: 'not_found' });
  }

  return send(response, 404, {});
});

/** Ответ API без служебных полей фальшивки. */
function publicView(payment) {
  const { return_url: _returnUrl, ...rest } = payment;
  return rest;
}

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Фальшивая ЮKassa на http://127.0.0.1:${PORT}\n`);
});
