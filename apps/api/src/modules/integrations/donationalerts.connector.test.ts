import type { AddressInfo } from 'node:net';
import type { IncomingAlertEvent } from '@streamkit/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws';
import { PlatformAuthError } from '../../common/http/platform-errors';
import type { DonationAlertsApi } from './donationalerts.api';
import { DonationAlertsConnector, normalizeDonation } from './donationalerts.connector';

const userId = '00000000-0000-4000-8000-000000000001';

describe('донат DonationAlerts → событие', () => {
  it('переводит дробную сумму в целые копейки без плавающей точки', () => {
    expect(
      normalizeDonation(
        { id: 1, username: 'Вася', message: 'привет', amount: 100.5, currency: 'RUB' },
        userId,
      ).amount,
    ).toEqual({ amountMinor: 10_050, currency: 'RUB' });
    expect(normalizeDonation({ id: 2, amount: 19.99, currency: 'USD' }, userId).amount).toEqual({
      amountMinor: 1999,
      currency: 'USD',
    });
    expect(normalizeDonation({ id: 3, amount: '250.00', currency: 'rub' }, userId).amount).toEqual({
      amountMinor: 25_000,
      currency: 'RUB',
    });
  });

  it('незнакомую валюту не выдаёт за рубли: сумма неизвестна, донат показывается', () => {
    const event = normalizeDonation(
      { id: 4, username: 'Джон', amount: 10, currency: 'GBP' },
      userId,
    );
    expect(event.amount).toBeNull();
    expect(event.username).toBe('Джон');
  });

  it('подставляет «Аноним», режет длинное и не показывает голосовое как текст', () => {
    expect(
      normalizeDonation({ id: 5, username: '  ', amount: 1, currency: 'RUB' }, userId).username,
    ).toBe('Аноним');
    const long = normalizeDonation(
      { id: 6, username: 'я'.repeat(100), message: 'м'.repeat(900), amount: 1, currency: 'RUB' },
      userId,
    );
    expect(long.username).toHaveLength(64);
    expect(long.message).toHaveLength(500);
    expect(
      normalizeDonation(
        {
          id: 7,
          message: 'https://…/voice.mp3',
          message_type: 'audio',
          amount: 1,
          currency: 'RUB',
        },
        userId,
      ).message,
    ).toBe('');
  });

  it('делает externalId строкой — на нём держится дедупликация', () => {
    expect(normalizeDonation({ id: 42, amount: 1, currency: 'RUB' }, userId).externalId).toBe('42');
  });
});

/**
 * Поддельный Centrifugo по документации DonationAlerts: ответ на подключение с
 * идентификатором клиента, ответ на подписку, публикации в канал.
 */
async function fakeCentrifugo() {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const sockets: ServerSocket[] = [];
  const frames: Array<Record<string, unknown>> = [];

  server.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('message', (data) => {
      const frame = JSON.parse(String(data)) as {
        id: number;
        method?: number;
        params?: Record<string, string>;
      };
      frames.push(frame);
      if (frame.id === 1 && frame.params?.token === 'socket-token') {
        socket.send(JSON.stringify({ id: 1, result: { client: `client-${sockets.length}` } }));
      }
      if (frame.method === 1) socket.send(JSON.stringify({ id: frame.id, result: {} }));
    });
  });

  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    frames,
    sockets,
    publish(donation: Record<string, unknown>) {
      // Две строки одним кадром — так Centrifugo склеивает ответы.
      const push = JSON.stringify({
        result: { channel: '$alerts:donation_777', data: { seq: 1, data: donation } },
      });
      sockets.at(-1)!.send(`${push}\n${JSON.stringify({ result: { channel: 'other' } })}`);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.terminate();
        server.close(() => resolve());
      }),
  };
}

function fakeApi(socketUrl: string, overrides: Partial<DonationAlertsApi> = {}) {
  const subscribed: Array<{ client: string; channel: string }> = [];
  const api = {
    socketUrl,
    fetchProfile: async () => ({
      id: '777',
      name: 'Стример',
      socketConnectionToken: 'socket-token',
    }),
    subscribeToken: async (_token: string, client: string, channel: string) => {
      subscribed.push({ client, channel });
      return 'channel-token';
    },
    ...overrides,
  } as unknown as DonationAlertsApi;
  return { api, subscribed };
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Условие не выполнилось');
}

describe('сокет DonationAlerts', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('подключается, подписывается на канал донатов и принимает донат', async () => {
    const centrifugo = await fakeCentrifugo();
    cleanups.push(centrifugo.close);
    const { api, subscribed } = fakeApi(centrifugo.url);
    const events: IncomingAlertEvent[] = [];

    const stop = await new DonationAlertsConnector(api).connect({
      userId,
      getAccessToken: async () => 'access',
      emit: async (event) => void events.push(event),
      reportFailure: () => undefined,
      onAccessLost: () => undefined,
    });
    cleanups.push(stop);

    await until(() => centrifugo.frames.some((frame) => frame.method === 1));
    expect(subscribed).toEqual([{ client: 'client-1', channel: '$alerts:donation_777' }]);
    expect(centrifugo.frames.find((frame) => frame.method === 1)).toMatchObject({
      params: { channel: '$alerts:donation_777', token: 'channel-token' },
    });

    centrifugo.publish({
      id: 9001,
      username: 'Зритель',
      message: 'Привет',
      amount: 150,
      currency: 'RUB',
    });
    await until(() => events.length === 1);
    expect(events[0]).toMatchObject({
      provider: 'donationalerts',
      externalId: '9001',
      username: 'Зритель',
      amount: { amountMinor: 15_000, currency: 'RUB' },
    });
  });

  it('после обрыва переподключается и подписывается заново', async () => {
    const centrifugo = await fakeCentrifugo();
    cleanups.push(centrifugo.close);
    const { api, subscribed } = fakeApi(centrifugo.url);

    const stop = await new DonationAlertsConnector(api).connect({
      userId,
      getAccessToken: async () => 'access',
      emit: async () => undefined,
      reportFailure: () => undefined,
      onAccessLost: () => undefined,
    });
    cleanups.push(stop);

    await until(() => subscribed.length === 1);
    centrifugo.sockets[0]!.terminate();
    await until(() => subscribed.length === 2);
    expect(subscribed[1]!.client).toBe('client-2');
  });

  it('потерянный доступ выключает источник и не переподключается', async () => {
    const centrifugo = await fakeCentrifugo();
    cleanups.push(centrifugo.close);
    const { api } = fakeApi(centrifugo.url, {
      fetchProfile: async () => {
        throw new PlatformAuthError('donationalerts', 401, 'Площадка отвергла токен');
      },
    });
    const lost: string[] = [];

    const stop = await new DonationAlertsConnector(api).connect({
      userId,
      getAccessToken: async () => 'access',
      emit: async () => undefined,
      reportFailure: () => undefined,
      onAccessLost: (reason) => void lost.push(reason),
    });
    cleanups.push(stop);

    await until(() => lost.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(centrifugo.sockets).toHaveLength(0);
    expect(lost).toHaveLength(1);
  });
});
