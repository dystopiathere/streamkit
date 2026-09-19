// Фальшивый Twitch для сквозного прогона: вход (OAuth) и профиль канала.
//
// Страница входа сразу «разрешает» доступ и возвращает браузер на redirect_uri
// с кодом — как настоящий Twitch после нажатия «Разрешить». Каждый вход выдаёт
// НОВЫЙ канал (e2e_streamer_1, _2, …): так проверяется переподключение на
// другой аккаунт, а сценарии не делят комнату чата. EventSub и метрики здесь
// не нужны: воркер в сквозном прогоне не запускается, события Twitch проверяет
// интеграционный тест `twitch-events.int.test.ts`.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_TWITCH_PORT ?? 3097);
/** Права, которые приложение просит сейчас: без них канал просил бы переподключения. */
const SCOPES = [
  'moderator:read:followers',
  'channel:read:subscriptions',
  'bits:read',
  'channel:read:redemptions',
];

let seq = 0;

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

  if (request.method === 'GET' && url.pathname === '/oauth2/authorize') {
    seq += 1;
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', `e2e-code-${seq}`);
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    response.writeHead(302, { Location: back.toString() });
    return response.end();
  }

  if (request.method === 'POST' && url.pathname === '/oauth2/token') {
    const form = new URLSearchParams(await readBody(request));
    const match = /^e2e-code-(\d+)$/.exec(form.get('code') ?? '');
    if (!match) return send(response, 400, { message: 'Invalid authorization code' });
    return send(response, 200, {
      access_token: `e2e-tw-access-${match[1]}`,
      refresh_token: `e2e-tw-refresh-${match[1]}`,
      expires_in: 14_400,
      scope: SCOPES,
      token_type: 'bearer',
    });
  }

  if (request.method === 'GET' && url.pathname === '/helix/users') {
    const match = /^Bearer e2e-tw-access-(\d+)$/.exec(request.headers.authorization ?? '');
    if (!match) return send(response, 401, { message: 'Invalid OAuth token' });
    return send(response, 200, {
      data: [
        {
          id: String(9000 + Number(match[1])),
          login: `e2e_streamer_${match[1]}`,
          display_name: `E2E Стример ${match[1]}`,
          profile_image_url: null,
        },
      ],
    });
  }

  send(response, 404, {});
}).listen(PORT, '127.0.0.1');
