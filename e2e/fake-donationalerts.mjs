// Фальшивый DonationAlerts для сквозного прогона: вход (OAuth) и профиль.
//
// Страница входа сразу «разрешает» доступ и возвращает браузер на redirect_uri
// с кодом — как настоящий DonationAlerts после нажатия «Разрешить». Сокет с
// донатами здесь не нужен: воркер в сквозном прогоне не запускается, его путь
// проверяет интеграционный тест `donation-sources.int.test.ts`.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_DONATIONALERTS_PORT ?? 3098);

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') return send(response, 200, { ok: true });

  if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', 'e2e-code');
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    response.writeHead(302, { Location: back.toString() });
    return response.end();
  }

  if (request.method === 'POST' && url.pathname === '/oauth/token') {
    const form = new URLSearchParams(await readBody(request));
    if (form.get('code') !== 'e2e-code') return send(response, 400, { error: 'invalid_grant' });
    return send(response, 200, {
      token_type: 'Bearer',
      access_token: 'e2e-da-access',
      refresh_token: 'e2e-da-refresh',
      expires_in: 3600,
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/user/oauth') {
    if (request.headers.authorization !== 'Bearer e2e-da-access') {
      return send(response, 401, { message: 'Unauthenticated.' });
    }
    return send(response, 200, {
      data: {
        id: 4242,
        code: 'e2e_streamer',
        name: 'E2E Стример DA',
        email: 'e2e-da@example.com',
        socket_connection_token: 'e2e-socket-token',
      },
    });
  }

  send(response, 404, {});
}).listen(PORT, '127.0.0.1');
