import { describe, expect, it } from 'vitest';
import { youtubeChatServiceDefinition, youtubeToChatMessage } from './youtube-chat';
import type { YouTubeChatItem, YouTubeChatResponse } from './youtube-chat.proto';

const CHANNEL = 'UC' + 'a'.repeat(22);
const AUTHOR = 'UC' + 'b'.repeat(22);

function text(overrides: Partial<YouTubeChatItem> = {}): YouTubeChatItem {
  return {
    id: 'LCC.message-1',
    snippet: {
      type: 'TEXT_MESSAGE_EVENT',
      publishedAt: '2026-09-19T18:00:00.123Z',
      displayMessage: 'привет стрим',
      textMessageDetails: { messageText: 'привет стрим' },
    },
    authorDetails: { channelId: AUTHOR, displayName: '@Зритель' },
    ...overrides,
  };
}

describe('сообщение чата YouTube → строка чата', () => {
  it('текст, автор по id канала, имя как есть, время — по часам YouTube', () => {
    expect(youtubeToChatMessage(text(), CHANNEL)).toEqual({
      id: 'LCC.message-1',
      platform: 'youtube',
      channel: CHANNEL,
      login: AUTHOR,
      username: '@Зритель',
      color: null,
      badges: [],
      parts: [{ kind: 'text', value: 'привет стрим' }],
      sentAt: '2026-09-19T18:00:00.123Z',
    });
  });

  it('значки YouTube ложатся на значки виджета', () => {
    const message = youtubeToChatMessage(
      text({
        authorDetails: {
          channelId: AUTHOR,
          displayName: 'Стример',
          isChatOwner: true,
          isChatModerator: true,
          isChatSponsor: true,
          isVerified: true,
        },
      }),
      CHANNEL,
    );
    expect(message?.badges).toEqual(['broadcaster', 'moderator', 'member', 'verified']);
  });

  it('суперчат, опрос и служебные события строкой чата не становятся', () => {
    for (const type of ['SUPER_CHAT_EVENT', 'POLL_EVENT', 'CHAT_ENDED_EVENT', 'TOMBSTONE']) {
      expect(
        youtubeToChatMessage(text({ snippet: { ...text().snippet, type } }), CHANNEL),
      ).toBeNull();
    }
  });

  it('пустой текст и автор без id канала — не сообщение, а мусор', () => {
    expect(
      youtubeToChatMessage(
        text({ snippet: { ...text().snippet, textMessageDetails: { messageText: '   ' } } }),
        CHANNEL,
      ),
    ).toBeNull();
    expect(
      youtubeToChatMessage(text({ authorDetails: { displayName: 'Без канала' } }), CHANNEL),
    ).toBeNull();
  });

  it('длинный текст режется по кодовым точкам, эмодзи не рвётся пополам', () => {
    const long = '😀'.repeat(600);
    const message = youtubeToChatMessage(
      text({ snippet: { ...text().snippet, textMessageDetails: { messageText: long } } }),
      CHANNEL,
    );
    const part = message?.parts[0];
    expect(part?.kind === 'text' && Array.from(part.value)).toHaveLength(500);
    expect(part?.kind === 'text' && part.value.endsWith('😀')).toBe(true);
  });
});

describe('прото потока чата', () => {
  it('ответ проходит сериализацию туда и обратно с официальными номерами полей', () => {
    const definition = youtubeChatServiceDefinition().StreamList;
    const response: YouTubeChatResponse = {
      nextPageToken: 'next-1',
      offlineAt: '2026-09-19T19:00:00Z',
      items: [text()],
    };
    const decoded = definition.responseDeserialize(
      definition.responseSerialize(response),
    ) as YouTubeChatResponse;

    expect(decoded.nextPageToken).toBe('next-1');
    expect(decoded.offlineAt).toBe('2026-09-19T19:00:00Z');
    expect(decoded.items?.[0]?.snippet?.type).toBe('TEXT_MESSAGE_EVENT');
    expect(decoded.items?.[0]?.authorDetails?.channelId).toBe(AUTHOR);
    expect(decoded.items?.[0]?.snippet?.textMessageDetails?.messageText).toBe('привет стрим');
  });

  it('подробности суперчата и спонсорства доезжают через разбор', () => {
    // Номер поля, списанный неверно, ошибки не даёт: разбор просто пропустит
    // его, и суперчат приедет без суммы. Этот тест ловит именно это.
    const definition = youtubeChatServiceDefinition().StreamList;
    const response: YouTubeChatResponse = {
      items: [
        {
          id: 'LCC.super',
          snippet: {
            type: 'SUPER_CHAT_EVENT',
            publishedAt: '2026-09-19T18:30:00Z',
            superChatDetails: {
              amountMicros: '1750000',
              currency: 'RUB',
              amountDisplayString: '1,75 ₽',
              userComment: 'спасибо',
            },
          },
        },
        {
          id: 'LCC.gift',
          snippet: {
            type: 'MEMBERSHIP_GIFTING_EVENT',
            publishedAt: '2026-09-19T18:31:00Z',
            membershipGiftingDetails: { giftMembershipsCount: 5, giftMembershipsLevelName: 'Друг' },
          },
        },
      ],
    };
    const decoded = definition.responseDeserialize(
      definition.responseSerialize(response),
    ) as YouTubeChatResponse;

    expect(decoded.items?.[0]?.snippet?.superChatDetails).toMatchObject({
      // uint64 приезжает строкой: `longs: String` в настройках разбора.
      amountMicros: '1750000',
      currency: 'RUB',
      userComment: 'спасибо',
    });
    expect(decoded.items?.[1]?.snippet?.membershipGiftingDetails).toMatchObject({
      giftMembershipsCount: 5,
      giftMembershipsLevelName: 'Друг',
    });
  });
});
