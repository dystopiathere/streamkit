import { describe, expect, it } from 'vitest';
import { type EventSubMessage, normalizeEventSubNotification } from './twitch-eventsub.connector';

const USER = '00000000-0000-4000-8000-000000000001';

function notification(type: string, event: Record<string, unknown>): EventSubMessage {
  return {
    metadata: {
      message_id: `msg-${type}`,
      message_type: 'notification',
      message_timestamp: '2026-09-19T18:00:00.123Z',
      subscription_type: type,
    },
    payload: { event },
  };
}

describe('уведомление EventSub → событие', () => {
  it('фолловер: имя, ключ дедупликации — message_id, время — по часам Twitch', () => {
    const event = normalizeEventSubNotification(
      notification('channel.follow', { user_name: 'Зритель', user_login: 'zritel' }),
      USER,
    );
    expect(event).toMatchObject({
      userId: USER,
      type: 'follow',
      provider: 'twitch',
      externalId: 'msg-channel.follow',
      username: 'Зритель',
      amount: null,
      count: null,
      occurredAt: '2026-09-19T18:00:00.123Z',
    });
  });

  it('подарочная подписка приходит одним алертом дарителя, а не на каждого получателя', () => {
    expect(
      normalizeEventSubNotification(
        notification('channel.subscribe', { user_name: 'Получатель', is_gift: true }),
        USER,
      ),
    ).toBeNull();
    expect(
      normalizeEventSubNotification(
        notification('channel.subscription.gift', {
          user_name: 'Даритель',
          total: 5,
          is_anonymous: false,
        }),
        USER,
      ),
    ).toMatchObject({ type: 'gift', username: 'Даритель', count: 5 });
  });

  it('анонимный подарок и анонимные биты — «Аноним», а не пустое имя', () => {
    expect(
      normalizeEventSubNotification(
        notification('channel.subscription.gift', {
          user_name: null,
          total: 1,
          is_anonymous: true,
        }),
        USER,
      )?.username,
    ).toBe('Аноним');
    expect(
      normalizeEventSubNotification(
        notification('channel.cheer', {
          user_name: null,
          is_anonymous: true,
          bits: 100,
          message: 'x',
        }),
        USER,
      ),
    ).toMatchObject({ type: 'cheer', username: 'Аноним', count: 100, message: 'x' });
  });

  it('продление: текст сообщения и месяцы; рейд: канал и зрители', () => {
    expect(
      normalizeEventSubNotification(
        notification('channel.subscription.message', {
          user_name: 'Старожил',
          cumulative_months: 12,
          message: { text: 'Год с вами' },
        }),
        USER,
      ),
    ).toMatchObject({ type: 'resubscription', count: 12, message: 'Год с вами' });
    expect(
      normalizeEventSubNotification(
        notification('channel.raid', { from_broadcaster_user_name: 'Сосед', viewers: 42 }),
        USER,
      ),
    ).toMatchObject({ type: 'raid', username: 'Сосед', count: 42 });
  });

  it('награда за баллы: название награды и ввод зрителя в тексте', () => {
    const redemption = (input: string) =>
      normalizeEventSubNotification(
        notification('channel.channel_points_custom_reward_redemption.add', {
          user_name: 'Зритель',
          user_input: input,
          reward: { title: 'Выбрать игру' },
        }),
        USER,
      );
    expect(redemption('')?.message).toBe('Выбрать игру');
    expect(redemption('Дота')?.message).toBe('Выбрать игру: Дота');
  });

  it('незнакомый тип и мусор вместо чисел не превращаются в событие с неверными данными', () => {
    expect(normalizeEventSubNotification(notification('channel.ban', {}), USER)).toBeNull();
    expect(
      normalizeEventSubNotification(
        notification('channel.cheer', { user_name: 'Зритель', bits: '100', message: '' }),
        USER,
      )?.count,
    ).toBeNull();
  });
});

describe('начало и конец эфира', () => {
  it('в алерт не превращаются: это сигнал сбору метрик, а не событие ленты', () => {
    // В ленте событий стримера им делать нечего — у события нет ни автора, ни
    // суммы. Их разбирает сессия и дёргает опрос метрик: без этого окно эфира
    // узнавало бы о начале трансляции через пятнадцать минут.
    expect(
      normalizeEventSubNotification(notification('stream.online', { type: 'live' }), USER),
    ).toBeNull();
    expect(normalizeEventSubNotification(notification('stream.offline', {}), USER)).toBeNull();
  });
});
