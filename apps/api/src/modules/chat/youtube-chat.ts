import * as grpc from '@grpc/grpc-js';
import { type ChatBadge, type ChatMessage, chatMessageSchema } from '@streamkit/contracts';
import * as protobuf from 'protobufjs';
import {
  YOUTUBE_CHAT_PROTO,
  type YouTubeChatItem,
  type YouTubeChatRequest,
  type YouTubeChatResponse,
} from './youtube-chat.proto';

/** Сколько текста берём из сообщения: схема части чата — до 500 символов. */
const MAX_TEXT_POINTS = 500;

/**
 * Сообщение чата YouTube → сообщение чата платформы. null — не текст зрителя
 * (суперчат, опрос, служебное) или данные не сходятся со схемой.
 *
 * Суперчаты, спонсорство и подарки идут тем же потоком, но это не строки чата,
 * а события — их место в сценариях оповещений, и туда они пока не подключены.
 */
export function youtubeToChatMessage(
  item: YouTubeChatItem,
  channel: string,
  /** Вызывается, когда текстовое сообщение не прошло схему: пути полей, без значений. */
  onRejected?: (paths: string[]) => void,
): ChatMessage | null {
  if (item.snippet?.type !== 'TEXT_MESSAGE_EVENT') return null;

  const raw = item.snippet.textMessageDetails?.messageText ?? item.snippet.displayMessage ?? '';
  // По кодовым точкам, а не единицам UTF-16: эмодзи не должна разрезаться пополам.
  const text = Array.from(raw.trim()).slice(0, MAX_TEXT_POINTS).join('');
  if (text.length === 0) return null;

  const author = item.authorDetails ?? {};
  const badges: ChatBadge[] = [];
  if (author.isChatOwner) badges.push('broadcaster');
  if (author.isChatModerator) badges.push('moderator');
  if (author.isChatSponsor) badges.push('member');
  if (author.isVerified) badges.push('verified');

  const publishedAt = Date.parse(item.snippet.publishedAt ?? '');
  const parsed = chatMessageSchema.safeParse({
    id: item.id,
    platform: 'youtube',
    channel,
    login: author.channelId ?? item.snippet.authorChannelId,
    username: author.displayName?.trim(),
    color: null,
    badges,
    parts: [{ kind: 'text', value: text }],
    sentAt: new Date(Number.isNaN(publishedAt) ? Date.now() : publishedAt).toISOString(),
  });
  if (!parsed.success) {
    onRejected?.(parsed.error.issues.map((issue) => issue.path.join('.')));
    return null;
  }
  return parsed.data;
}

let messageTypes: { request: protobuf.Type; response: protobuf.Type } | null = null;

function types(): { request: protobuf.Type; response: protobuf.Type } {
  if (!messageTypes) {
    const root = protobuf.parse(YOUTUBE_CHAT_PROTO, { keepCase: false }).root;
    messageTypes = {
      request: root.lookupType('youtube.api.v3.LiveChatMessageListRequest'),
      response: root.lookupType('youtube.api.v3.LiveChatMessageListResponse'),
    };
  }
  return messageTypes;
}

/** Как отдавать разобранное сообщение: перечисления строками, без полей по умолчанию. */
const TO_OBJECT: protobuf.IConversionOptions = { enums: String, longs: String, defaults: false };

/**
 * Описание сервиса для grpc-js — общее для клиента и поддельного сервера в
 * тестах. Сериализация через protobufjs по разобранному прото: генерировать
 * код из `.proto` ради одного метода незачем.
 */
export function youtubeChatServiceDefinition(): grpc.ServiceDefinition {
  const { request, response } = types();
  return {
    StreamList: {
      path: '/youtube.api.v3.V3DataLiveChatMessageService/StreamList',
      requestStream: false,
      responseStream: true,
      requestSerialize: (value: YouTubeChatRequest) =>
        Buffer.from(request.encode(request.fromObject(value)).finish()),
      requestDeserialize: (buffer: Buffer) =>
        request.toObject(request.decode(buffer), TO_OBJECT) as YouTubeChatRequest,
      responseSerialize: (value: YouTubeChatResponse) =>
        Buffer.from(response.encode(response.fromObject(value)).finish()),
      responseDeserialize: (buffer: Buffer) =>
        response.toObject(response.decode(buffer), TO_OBJECT) as YouTubeChatResponse,
    },
  };
}

export interface YouTubeChatClient extends grpc.Client {
  StreamList(
    request: YouTubeChatRequest,
    metadata: grpc.Metadata,
  ): grpc.ClientReadableStream<YouTubeChatResponse>;
}

export function createYouTubeChatClient(target: string, insecure: boolean): YouTubeChatClient {
  const Client = grpc.makeGenericClientConstructor(
    youtubeChatServiceDefinition(),
    'V3DataLiveChatMessageService',
  );
  return new Client(
    target,
    insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl(),
  ) as unknown as YouTubeChatClient;
}
