import { generateKeyPairSync, sign } from 'node:crypto';
import { chatMessageSchema, incomingAlertEventSchema } from '@streamkit/contracts';
import { describe, expect, it } from 'vitest';
import {
  kickChatParts,
  liveStateOf,
  normalizeKickEvent,
  readKickHeaders,
  toKickChatMessage,
  verifyKickSignature,
} from './kick-events';
import { missingKickEvents } from './kick-events.connector';
import { KICK_ALERT_EVENTS } from './kick.provider';

/** Тела событий — из раздела Webhook Payloads документации Kick. */
const BROADCASTER = {
  is_anonymous: false,
  user_id: 123456789,
  username: 'broadcaster_name',
  is_verified: true,
  profile_picture: 'https://example.com/broadcaster_avatar.jpg',
  channel_slug: 'broadcaster_channel',
  identity: null,
};

const viewer = (username: string, id = 987654321) => ({
  is_anonymous: false,
  user_id: id,
  username,
  is_verified: false,
  profile_picture: 'https://example.com/sender_avatar.jpg',
  channel_slug: `${username}_channel`,
  identity: null,
});

const USER_ID = '6f1c1c43-3d9a-4a8a-9d0a-6f0c9a6f7c11';
const headers = (eventType: string) => ({ messageId: '01JHF9ZK9XJ3M7Q2', eventType });

describe('подпись вебхука Kick', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const body = Buffer.from('{"broadcaster":{"user_id":1}}');
  const signed = (id: string, timestamp: string, raw: Buffer) =>
    sign('sha256', Buffer.concat([Buffer.from(`${id}.${timestamp}.`), raw]), privateKey).toString(
      'base64',
    );

  it('принимает подпись над id, временем и сырым телом', () => {
    const signature = signed('m1', '2026-09-25T10:00:00Z', body);
    expect(
      verifyKickSignature(
        pem,
        { messageId: 'm1', timestamp: '2026-09-25T10:00:00Z', signature },
        body,
      ),
    ).toBe(true);
  });

  it('тело, пересобранное с другими пробелами, уже не подходит', () => {
    const signature = signed('m1', '2026-09-25T10:00:00Z', body);
    const reformatted = Buffer.from('{ "broadcaster": { "user_id": 1 } }');
    expect(
      verifyKickSignature(
        pem,
        { messageId: 'm1', timestamp: '2026-09-25T10:00:00Z', signature },
        reformatted,
      ),
    ).toBe(false);
  });

  it('чужой id сообщения — подмена, даже с настоящей подписью', () => {
    const signature = signed('m1', '2026-09-25T10:00:00Z', body);
    expect(
      verifyKickSignature(
        pem,
        { messageId: 'm2', timestamp: '2026-09-25T10:00:00Z', signature },
        body,
      ),
    ).toBe(false);
  });

  it('мусор вместо подписи или ключа — отказ, а не исключение', () => {
    expect(
      verifyKickSignature(pem, { messageId: 'm1', timestamp: 't', signature: '%%%' }, body),
    ).toBe(false);
    expect(
      verifyKickSignature('не ключ', { messageId: 'm1', timestamp: 't', signature: 'AA==' }, body),
    ).toBe(false);
  });

  it('ключ по умолчанию — из документации Kick — разбирается', () => {
    const docsKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;
    // Подпись чужая — ответ «нет», но не падение на разборе ключа.
    const signature = signed('m1', 't', body);
    expect(verifyKickSignature(docsKey, { messageId: 'm1', timestamp: 't', signature }, body)).toBe(
      false,
    );
  });
});

describe('заголовки вебхука Kick', () => {
  it('без любого из заголовков проверять нечего', () => {
    const full = {
      'kick-event-message-id': 'm1',
      'kick-event-message-timestamp': '2026-09-25T10:00:00Z',
      'kick-event-signature': 'sig',
      'kick-event-type': 'channel.followed',
      'kick-event-version': '1',
    };
    expect(readKickHeaders(full)).toEqual({
      messageId: 'm1',
      timestamp: '2026-09-25T10:00:00Z',
      signature: 'sig',
      eventType: 'channel.followed',
      eventVersion: '1',
    });
    const { 'kick-event-signature': _omit, ...unsigned } = full;
    expect(readKickHeaders(unsigned)).toBeNull();
  });
});

describe('события Kick → оповещения', () => {
  const normalize = (eventType: string, payload: Record<string, unknown>) => {
    const event = normalizeKickEvent(
      headers(eventType),
      { broadcaster: BROADCASTER, ...payload },
      USER_ID,
    );
    // Всё, что уходит в приём событий, обязано пройти его схему.
    if (event) incomingAlertEventSchema.parse(event);
    return event;
  };

  it('фолловер', () => {
    expect(normalize('channel.followed', { follower: viewer('follower_name') })).toMatchObject({
      type: 'follow',
      provider: 'kick',
      username: 'follower_name',
      externalId: '01JHF9ZK9XJ3M7Q2',
      count: null,
    });
  });

  it('новая подписка и продление с числом месяцев', () => {
    expect(
      normalize('channel.subscription.new', {
        subscriber: viewer('subscriber_name'),
        duration: 1,
        created_at: '2025-01-14T16:08:06Z',
      }),
    ).toMatchObject({
      type: 'subscription',
      username: 'subscriber_name',
      occurredAt: '2025-01-14T16:08:06.000Z',
    });
    expect(
      normalize('channel.subscription.renewal', {
        subscriber: viewer('subscriber_name'),
        duration: 3,
      }),
    ).toMatchObject({ type: 'resubscription', count: 3 });
  });

  it('подарок — одним алертом дарителя с числом подписок', () => {
    expect(
      normalize('channel.subscription.gifts', {
        gifter: viewer('gifter_name'),
        giftees: [viewer('a', 1), viewer('b', 2), viewer('c', 3)],
      }),
    ).toMatchObject({ type: 'gift', username: 'gifter_name', count: 3 });
  });

  it('анонимный даритель — «Аноним», а не пустой ник', () => {
    expect(
      normalize('channel.subscription.gifts', {
        gifter: { is_anonymous: true, user_id: null, username: null },
        giftees: [viewer('a', 1)],
      }),
    ).toMatchObject({ username: 'Аноним' });
  });

  it('награда: название и ввод зрителя, ключ — id обмена', () => {
    const payload = {
      id: '01KBHE78QE4HZY1617DK5FC7YD',
      user_input: 'спой песню',
      status: 'pending',
      redeemed_at: '2025-12-02T22:54:19.323Z',
      reward: { id: 'r1', title: 'Песня', cost: 1000, description: '' },
      redeemer: { user_id: 123, username: 'viewer', is_verified: false, channel_slug: 'viewer' },
    };
    const pending = normalize('channel.reward.redemption.updated', payload);
    const accepted = normalize('channel.reward.redemption.updated', {
      ...payload,
      status: 'accepted',
    });
    expect(pending).toMatchObject({
      type: 'reward',
      message: 'Песня: спой песню',
      externalId: 'redemption:01KBHE78QE4HZY1617DK5FC7YD',
    });
    // Взятие и одобрение из очереди — одна награда, и дедупликация делает из
    // них один алерт.
    expect(accepted?.externalId).toBe(pending?.externalId);
  });

  it('отклонённая награда — не алерт', () => {
    expect(
      normalize('channel.reward.redemption.updated', {
        id: 'x',
        status: 'rejected',
        reward: { title: 'Песня' },
        redeemer: viewer('viewer'),
      }),
    ).toBeNull();
  });

  it('эфир, чат и KICKs оповещениями не становятся', () => {
    expect(normalize('livestream.status.updated', { is_live: true })).toBeNull();
    expect(normalize('chat.message.sent', { content: 'привет' })).toBeNull();
    expect(normalize('kicks.gifted', { gift: { amount: 500 } })).toBeNull();
  });
});

describe('сигнал эфира Kick', () => {
  it('начало и конец эфира', () => {
    expect(liveStateOf('livestream.status.updated', { is_live: true })).toBe(true);
    expect(liveStateOf('livestream.status.updated', { is_live: false })).toBe(false);
    expect(liveStateOf('channel.followed', { is_live: true })).toBeNull();
  });
});

describe('чат Kick', () => {
  const payload = {
    message_id: 'unique_message_id_123',
    broadcaster: BROADCASTER,
    sender: {
      ...viewer('sender_name'),
      identity: {
        username_color: '#FF5733',
        badges: [
          { text: 'Moderator', type: 'moderator' },
          { text: 'Sub Gifter', type: 'sub_gifter', count: 5 },
          { text: 'Subscriber', type: 'subscriber', count: 3 },
        ],
      },
    },
    content: 'Hello [emote:4148074:HYPERCLAP] [emote:37226:KEKW]',
    created_at: '2025-01-14T16:08:06Z',
  };

  it('сообщение проходит схему чата', () => {
    const message = toKickChatMessage(payload);
    expect(chatMessageSchema.parse(message)).toEqual({
      platform: 'kick',
      id: 'unique_message_id_123',
      channel: '123456789',
      login: '987654321',
      username: 'sender_name',
      color: '#FF5733',
      badges: ['moderator', 'subscriber'],
      parts: [{ kind: 'text', value: 'Hello HYPERCLAP KEKW' }],
      sentAt: '2025-01-14T16:08:06.000Z',
    });
  });

  it('эмоут — своим названием, текст вокруг не трогается', () => {
    expect(kickChatParts('[emote:1:A]b[emote:2:C] [x]')).toEqual([
      { kind: 'text', value: 'AbC [x]' },
    ]);
  });

  it('без автора или канала строки нет', () => {
    expect(toKickChatMessage({ ...payload, sender: undefined })).toBeNull();
    expect(toKickChatMessage({ ...payload, broadcaster: undefined })).toBeNull();
  });

  it('цвет не из формы #RRGGBB не проходит', () => {
    const odd = {
      ...payload,
      sender: { ...payload.sender, identity: { username_color: 'red', badges: [] } },
    };
    expect(toKickChatMessage(odd)?.color).toBeNull();
  });
});

describe('сверка подписок Kick', () => {
  it('подписывает только недостающие события', () => {
    expect(
      missingKickEvents([{ event: 'channel.followed' }, { event: 'chat.message.sent' }]),
    ).toEqual(KICK_ALERT_EVENTS.filter((event) => event !== 'channel.followed'));
    expect(missingKickEvents(KICK_ALERT_EVENTS.map((event) => ({ event })))).toEqual([]);
  });
});

describe('вебхук Kick и лимиты запросов', () => {
  it('не ограничен ни одним лимитером', async () => {
    // События и чат всех стримеров идут с нескольких адресов Kick, и лимит на
    // IP остановил бы их за секунды. `@SkipThrottle()` без аргументов снимает
    // только `default`; в интеграционных тестах лимиты подняты, ловится здесь.
    const { KickWebhookController } = await import('./kick-webhook.controller');
    for (const throttler of ['default', 'auth']) {
      expect(Reflect.getMetadata(`THROTTLER:SKIP${throttler}`, KickWebhookController)).toBe(true);
    }
  });
});
