// Фальшивый YouTube для сквозного прогона: вход Google (OAuth) и канал.
//
// Страница входа сразу «разрешает» доступ и возвращает браузер на redirect_uri
// с кодом — как Google после «Разрешить». Каждый вход выдаёт НОВЫЙ канал
// (UCe2e_yt_…1, …2): сценарии не делят комнату чата. Потока чата здесь нет:
// воркер в сквозном прогоне не запускается, путь gRPC `streamList` проверяет
// интеграционный тест `youtube-chat.int.test.ts`.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_YOUTUBE_PORT ?? 3096);

let seq = 0;

/** Id канала YouTube: UC и ровно 22 символа, как у настоящего. */
const channelId = (n) => `UCe2e_yt_${String(n).padStart(15, '0')}`;

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

  if (request.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') {
    seq += 1;
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', `e2e-yt-code-${seq}`);
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    response.writeHead(302, { Location: back.toString() });
    return response.end();
  }

  if (request.method === 'POST' && url.pathname === '/token') {
    const form = new URLSearchParams(await readBody(request));
    const match = /^e2e-yt-code-(\d+)$/.exec(form.get('code') ?? '');
    if (!match) return send(response, 400, { error: 'invalid_grant' });
    return send(response, 200, {
      access_token: `e2e-yt-access-${match[1]}`,
      refresh_token: `e2e-yt-refresh-${match[1]}`,
      expires_in: 3599,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      token_type: 'Bearer',
    });
  }

  if (request.method === 'GET' && url.pathname === '/youtube/v3/channels') {
    const match = /^Bearer e2e-yt-access-(\d+)$/.exec(request.headers.authorization ?? '');
    if (!match)
      return send(response, 401, { error: { code: 401, message: 'Invalid Credentials' } });
    const n = Number(match[1]);
    return send(response, 200, {
      items: [
        {
          id: channelId(n),
          snippet: { title: `E2E YouTube ${n}`, customUrl: `@e2e_yt_${n}` },
          statistics: { subscriberCount: '10', viewCount: '100' },
        },
      ],
    });
  }

  send(response, 404, {});
}).listen(PORT, '127.0.0.1');
