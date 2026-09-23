import { ServiceUnavailableException } from '@nestjs/common';
import { TokenVerifier, TrackSource } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.service';
import { LiveKitRoomMediaServer, LiveKitTokens, livekitRoomName } from './livekit.service';

const LIVEKIT = {
  url: 'http://livekit.internal:7880',
  publicUrl: 'wss://rtc.example.ru',
  apiKey: 'unit-key',
  apiSecret: 'unit-secret-at-least-thirty-two-characters',
};

const configured = { livekit: LIVEKIT } as AppConfig;
const missing = { livekit: null } as AppConfig;
const ROOM = '00000000-0000-4000-8000-0000000000aa';

async function claims(token: string) {
  return new TokenVerifier(LIVEKIT.apiKey, LIVEKIT.apiSecret).verify(token);
}

describe('токены LiveKit', () => {
  it('отдают браузеру публичный адрес, а не внутренний', async () => {
    // Два адреса легко перепутать, и проявится это только в собранном окружении.
    const access = await new LiveKitTokens(configured).issue(ROOM, {
      role: 'host',
      identity: 'host:x',
      name: 'Стример',
    });
    expect(access.url).toBe(LIVEKIT.publicUrl);
  });

  it('гость публикует только камеру и микрофон и не шлёт данные', async () => {
    const access = await new LiveKitTokens(configured).issue(ROOM, {
      role: 'guest',
      identity: 'guest:x:y',
      name: 'Вася',
      microphone: true,
    });
    const grant = (await claims(access.token)).video;

    expect(grant?.room).toBe(livekitRoomName(ROOM));
    expect(grant?.canPublishSources).toEqual(['camera', 'microphone']);
    expect(grant?.canPublishData).toBe(false);
    // Свои атрибуты — да: ими гость сообщает, зеркалить ли его камеру. Чужие
    // этим правом не изменить, и комнатой оно не управляет.
    expect(grant?.canUpdateOwnMetadata).toBe(true);
    expect(grant?.roomAdmin).toBeUndefined();
  });

  it('гостю с выключенным стримером микрофоном токен выдаётся без микрофона', async () => {
    // Запрет живёт на ссылке: иначе гость снимал бы его перезагрузкой вкладки.
    const access = await new LiveKitTokens(configured).issue(ROOM, {
      role: 'guest',
      identity: 'guest:x:y',
      name: 'Вася',
      microphone: false,
    });
    expect((await claims(access.token)).video?.canPublishSources).toEqual(['camera']);
  });

  it('оверлей невидим и ничего не публикует', async () => {
    const access = await new LiveKitTokens(configured).issue(ROOM, {
      role: 'overlay',
      identity: 'overlay:x',
    });
    const token = await claims(access.token);

    expect(token.video).toMatchObject({ hidden: true, canPublish: false, canSubscribe: true });
    expect(token.name).toBeUndefined();
  });

  it('токен живёт пять минут: это окно входа, а не длина сессии', async () => {
    const access = await new LiveKitTokens(configured).issue(ROOM, {
      role: 'guest',
      identity: 'guest:x:y',
      name: 'Вася',
      microphone: true,
    });
    const token = await claims(access.token);
    expect((token.exp ?? 0) - (token.nbf ?? 0)).toBe(300);
  });

  it('без настроенного LiveKit отвечают «не настроено», а не падают', async () => {
    await expect(
      new LiveKitTokens(missing).issue(ROOM, { role: 'overlay', identity: 'overlay:x' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(new LiveKitRoomMediaServer(missing).listParticipants(ROOM)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('вебхук LiveKit и лимиты запросов', () => {
  it('не ограничен ни одним лимитером', async () => {
    // Все события идут с одного адреса медиасервера. `@SkipThrottle()` без
    // аргументов снимал только `default`, и жёсткий лимит `auth` отвечал 429 уже
    // на одиннадцатом вебхуке — проверка входа молча переставала работать.
    // В интеграционных тестах лимиты подняты, поэтому ловится только здесь.
    const { LiveKitWebhookController } = await import('./rooms.controller');
    for (const throttler of ['default', 'auth']) {
      expect(Reflect.getMetadata(`THROTTLER:SKIP${throttler}`, LiveKitWebhookController)).toBe(
        true,
      );
    }
  });
});

describe('медиасервер и ушедшие участники', () => {
  /** Медиасервер с подменённым клиентом SDK: отвечает «не найдено» на всё. */
  function goneServer(): LiveKitRoomMediaServer {
    const server = new LiveKitRoomMediaServer(configured);
    const notFound = () => Promise.reject(Object.assign(new Error('not found'), { status: 404 }));
    (server as unknown as { client: unknown }).client = {
      removeParticipant: notFound,
      mutePublishedTrack: notFound,
      updateParticipant: notFound,
    };
    return server;
  }

  it('смена права на публикацию не отнимает право на свои атрибуты', async () => {
    // LiveKit заменяет права целиком: не переданное сбрасывается. Забыть здесь
    // `canUpdateMetadata` значило бы отнять у гостя выбор зеркала в тот момент,
    // когда стример выключил ему микрофон.
    const server = new LiveKitRoomMediaServer(configured);
    const calls: { permission?: Record<string, unknown> }[] = [];
    (server as unknown as { client: unknown }).client = {
      updateParticipant: (
        _room: string,
        _identity: string,
        update: { permission?: Record<string, unknown> },
      ) => {
        calls.push(update);
        return Promise.resolve();
      },
    };
    await server.setPublishSources(ROOM, 'guest:x:y', ['camera']);
    expect(calls[0]?.permission).toMatchObject({
      // Камера — это TrackSource.CAMERA, у SDK она числом.
      canPublishSources: [TrackSource.CAMERA],
      canUpdateMetadata: true,
      canPublishData: false,
    });
  });

  it('действие над ушедшим участником не считается сбоем', async () => {
    // Запрет микрофона обходит все вкладки гостя, и вкладка, которую он только
    // что перезагрузил, уже не существует. Сбой на ней оставлял микрофон остальным.
    const server = goneServer();
    await expect(server.removeParticipant(ROOM, 'guest:x:y')).resolves.toBeUndefined();
    await expect(server.muteTrack(ROOM, 'guest:x:y', 'TR_1')).resolves.toBeUndefined();
    await expect(server.setPublishSources(ROOM, 'guest:x:y', ['camera'])).resolves.toBeUndefined();
  });
});
