import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  parseParticipantIdentity,
  ROOM_ACCESS_TTL_SECONDS,
  type RoomAccess,
  type RoomParticipant,
} from '@streamkit/contracts';
import { AccessToken, RoomServiceClient, TrackSource, TrackType } from 'livekit-server-sdk';
import { AppConfig } from '../../config/app-config.service';

/**
 * Имя комнаты в LiveKit.
 *
 * Идентификатор нашей записи, а не название, которое вписал стример: название
 * меняется и повторяется у разных людей, а комната LiveKit создаётся при первом
 * входе по имени — два стримера с комнатой «Подкаст» оказались бы в одной.
 */
export function livekitRoomName(roomId: string): string {
  return `room-${roomId}`;
}

/**
 * Серверный API медиасервера — ровно то, чем пользуется платформа.
 *
 * Интерфейс, а не прямой вызов SDK, ради тестов: интеграционные тесты проверяют
 * нашу логику (кому выдать доступ, кого можно удалить) и подменяют сервер, а не
 * поднимают LiveKit. Сквозной тест ходит в настоящий.
 */
export interface RoomMediaServer {
  /** Участники комнаты. Комнаты, в которую ещё никто не входил, нет — это пустой список. */
  listParticipants(roomId: string): Promise<RoomParticipant[]>;
  removeParticipant(roomId: string, identity: string): Promise<void>;
  muteTrack(roomId: string, identity: string, trackSid: string): Promise<void>;
}

export const ROOM_MEDIA_SERVER = Symbol('ROOM_MEDIA_SERVER');

/** Кто входит: от этого зависят права в токене. */
export type AccessRole =
  | { role: 'host'; identity: string; name: string }
  | { role: 'guest'; identity: string; name: string }
  | { role: 'overlay'; identity: string };

@Injectable()
export class LiveKitRoomMediaServer implements RoomMediaServer {
  private client: RoomServiceClient | null = null;

  constructor(private readonly config: AppConfig) {}

  async listParticipants(roomId: string): Promise<RoomParticipant[]> {
    let participants;
    try {
      participants = await this.service().listParticipants(livekitRoomName(roomId));
    } catch (error) {
      // Комната LiveKit создаётся первым вошедшим и удаляется, когда опустела.
      // «Нет такой комнаты» — штатное «в комнате никого», а не сбой.
      if (isNotFound(error)) return [];
      throw error;
    }

    return participants.flatMap((participant) => {
      const parsed = parseParticipantIdentity(participant.identity);
      if (!parsed) return [];
      return [
        {
          identity: participant.identity,
          role: parsed.role,
          name: participant.name,
          joinedAt: new Date(Number(participant.joinedAt) * 1000).toISOString(),
          tracks: participant.tracks.map((track) => ({
            sid: track.sid,
            kind: track.type === TrackType.VIDEO ? ('video' as const) : ('audio' as const),
            muted: track.muted,
          })),
        },
      ];
    });
  }

  async removeParticipant(roomId: string, identity: string): Promise<void> {
    try {
      await this.service().removeParticipant(livekitRoomName(roomId), identity);
    } catch (error) {
      // Гость успел выйти сам — цель достигнута.
      if (!isNotFound(error)) throw error;
    }
  }

  async muteTrack(roomId: string, identity: string, trackSid: string): Promise<void> {
    await this.service().mutePublishedTrack(livekitRoomName(roomId), identity, trackSid, true);
  }

  private service(): RoomServiceClient {
    const livekit = this.config.livekit;
    if (!livekit) throw notConfigured();
    this.client ??= new RoomServiceClient(livekit.url, livekit.apiKey, livekit.apiSecret);
    return this.client;
  }
}

/**
 * Выпуск токенов доступа к комнате.
 *
 * Права выставляются здесь и только здесь. Роль участника зашита префиксом
 * идентичности, а не атрибутом, который клиент вправе поменять сам.
 */
@Injectable()
export class LiveKitTokens {
  constructor(private readonly config: AppConfig) {}

  async issue(roomId: string, access: AccessRole): Promise<RoomAccess> {
    const livekit = this.config.livekit;
    if (!livekit) throw notConfigured();

    const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
      identity: access.identity,
      name: access.role === 'overlay' ? undefined : access.name,
      // Окно входа, а не длина сессии: подключённому клиенту LiveKit продлевает
      // токен сам. Короткий срок — это и есть механизм отзыва.
      ttl: ROOM_ACCESS_TTL_SECONDS,
    });

    const room = livekitRoomName(roomId);
    switch (access.role) {
      case 'host':
      case 'guest':
        token.addGrant({
          room,
          roomJoin: true,
          canSubscribe: true,
          // Только камера и микрофон. Показ экрана гостем — это отдельное
          // решение стримера, а не право по умолчанию: картинку в эфир выводит он.
          canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
          // Сообщения данных комнате не нужны, а открытый канал между
          // незнакомыми людьми — лишняя поверхность.
          canPublishData: false,
          canUpdateOwnMetadata: false,
        });
        break;

      case 'overlay':
        token.addGrant({
          room,
          roomJoin: true,
          canSubscribe: true,
          canPublish: false,
          canPublishData: false,
          // Невидим для остальных: гость не должен видеть в списке участников
          // «overlay:…», а стример — думать, что в комнату кто-то зашёл.
          hidden: true,
        });
        break;
    }

    return { url: livekit.publicUrl, token: await token.toJwt() };
  }
}

function notConfigured(): ServiceUnavailableException {
  return new ServiceUnavailableException('Приватные комнаты не настроены на этом сервере');
}

/** `ServerError` LiveKit с кодом «не найдено»: отдельного класса под этот случай у SDK нет. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, code } = error as { status?: number; code?: string };
  return status === 404 || code === 'not_found';
}
