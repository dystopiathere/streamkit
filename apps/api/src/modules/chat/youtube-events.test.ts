import { describe, expect, it } from 'vitest';
import type { YouTubeChatItem } from './youtube-chat.proto';
import { normalizeYouTubeChatEvent } from './youtube-events';

const USER = '11111111-1111-4111-8111-111111111111';
const AUTHOR = 'UC' + 'b'.repeat(22);

function item(snippet: NonNullable<YouTubeChatItem['snippet']>): YouTubeChatItem {
  return {
    id: 'LCC.event-1',
    snippet: { publishedAt: '2026-09-23T18:00:00.000Z', ...snippet },
    authorDetails: { channelId: AUTHOR, displayName: 'Аня' },
  };
}

describe('события YouTube из потока чата', () => {
  it('суперчат — донат с суммой: микро переводятся в копейки', () => {
    const event = normalizeYouTubeChatEvent(
      item({
        type: 'SUPER_CHAT_EVENT',
        superChatDetails: {
          // Суммы больше двух миллиардов микро в 32 бита не влезают, поэтому
          // protobufjs отдаёт их строкой.
          amountMicros: '1750000',
          currency: 'RUB',
          amountDisplayString: '1,75 ₽',
          userComment: 'спасибо за стрим',
        },
      }),
      USER,
    );
    expect(event).toMatchObject({
      type: 'donation',
      provider: 'youtube',
      externalId: 'LCC.event-1',
      username: 'Аня',
      amount: { amountMinor: 175, currency: 'RUB' },
      message: 'спасибо за стрим',
      occurredAt: '2026-09-23T18:00:00.000Z',
    });
  });

  it('суперчат в валюте, которой платформа не считает, не теряется', () => {
    // Йены в цель не сложить — но оповещение всё равно должно выйти в кадр, и
    // сумма видна строкой.
    const event = normalizeYouTubeChatEvent(
      item({
        type: 'SUPER_CHAT_EVENT',
        superChatDetails: {
          amountMicros: '500000000',
          currency: 'JPY',
          amountDisplayString: '¥500',
          userComment: 'привет',
        },
      }),
      USER,
    );
    expect(event).toMatchObject({ type: 'donation', amount: null, message: '¥500 · привет' });
  });

  it('суперстикер — донат, а текст берётся из описания стикера', () => {
    const event = normalizeYouTubeChatEvent(
      item({
        type: 'SUPER_STICKER_EVENT',
        superStickerDetails: {
          amountMicros: '200000000',
          currency: 'RUB',
          superStickerMetadata: { altText: 'Кот с сердечком' },
        },
      }),
      USER,
    );
    expect(event).toMatchObject({
      type: 'donation',
      amount: { amountMinor: 20_000, currency: 'RUB' },
      message: 'Кот с сердечком',
    });
  });

  it('новый спонсор — подписка, веха — продление с числом месяцев', () => {
    expect(
      normalizeYouTubeChatEvent(
        item({ type: 'NEW_SPONSOR_EVENT', newSponsorDetails: { memberLevelName: 'Друг канала' } }),
        USER,
      ),
    ).toMatchObject({ type: 'subscription', message: 'Друг канала', count: null });

    expect(
      normalizeYouTubeChatEvent(
        item({
          type: 'MEMBER_MILESTONE_CHAT_EVENT',
          memberMilestoneChatDetails: { memberMonth: 7, userComment: 'седьмой месяц' },
        }),
        USER,
      ),
    ).toMatchObject({ type: 'resubscription', count: 7, message: 'седьмой месяц' });
  });

  it('подаренные спонсорства — один подарок дарителя, а не пять у получателей', () => {
    expect(
      normalizeYouTubeChatEvent(
        item({
          type: 'MEMBERSHIP_GIFTING_EVENT',
          membershipGiftingDetails: { giftMembershipsCount: 5, giftMembershipsLevelName: 'Друг' },
        }),
        USER,
      ),
    ).toMatchObject({ type: 'gift', count: 5 });

    // Получателей пропускаем — иначе на пять подарков вышло бы шесть алертов.
    expect(
      normalizeYouTubeChatEvent(item({ type: 'GIFT_MEMBERSHIP_RECEIVED_EVENT' }), USER),
    ).toBeNull();
  });

  it('чат, опросы и служебные строки событиями не становятся', () => {
    for (const type of ['TEXT_MESSAGE_EVENT', 'POLL_EVENT', 'CHAT_ENDED_EVENT', 'TOMBSTONE']) {
      expect(normalizeYouTubeChatEvent(item({ type }), USER)).toBeNull();
    }
  });

  it('суперчат без подробностей не превращается в донат на ноль', () => {
    // Часть `snippet` может не прийти, если её не запросили или YouTube её не
    // заполнил: донат без суммы и без текста в кадре — это пустое оповещение.
    expect(normalizeYouTubeChatEvent(item({ type: 'SUPER_CHAT_EVENT' }), USER)).toBeNull();
  });

  it('имя автора обязательно: схема события без него не примет', () => {
    const event = normalizeYouTubeChatEvent(
      {
        id: 'LCC.event-2',
        snippet: { type: 'NEW_SPONSOR_EVENT', publishedAt: '2026-09-23T18:00:00.000Z' },
      },
      USER,
    );
    expect(event?.username).toBe('Зритель');
  });
});
