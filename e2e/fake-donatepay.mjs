// Фальшивый DonatePay для сквозного прогона: проверка ключа API профилем.
//
// Ключ приходит параметром `access_token`, неверный ключ — ответ 200 со
// `status: "error"`, как у настоящего API. Опрос донатов здесь не нужен:
// воркер в сквозном прогоне не запускается, его путь проверяет
// интеграционный тест `donation-sources.int.test.ts`.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_DONATEPAY_PORT ?? 3095);
const VALID_KEY = 'e2e-dp-key';

function send(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') return send(response, { ok: true });

  if (request.method === 'GET' && url.pathname === '/api/v1/user') {
    if (url.searchParams.get('access_token') !== VALID_KEY) {
      return send(response, { status: 'error', message: 'Incorrect token' });
    }
    return send(response, {
      status: 'success',
      data: { id: 4343, name: 'E2E Стример DP', avatar: null, balance: 0, cashout_sum: 0 },
    });
  }

  response.writeHead(404);
  response.end();
}).listen(PORT, '127.0.0.1');
