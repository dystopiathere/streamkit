import {
  type Currency,
  CURRENCIES,
  type IncomingAlertEvent,
  MINOR_UNITS_PER_MAJOR,
} from '@streamkit/contracts';
import type { YouTubeChatItem } from './youtube-chat.proto';

/**
 * События YouTube: спонсорства и платная поддержка.
 *
 * У YouTube нет подписки на события, как EventSub у Twitch: суперчаты, новые
 * спонсоры и подаренные спонсорства приходят СТРОКАМИ ТОГО ЖЕ ПОТОКА, что и
 * чат. Отсюда две особенности, которых нет у Twitch: события идут, только пока
 * поток открыт (то есть пока открыт оверлей), и стоят квоты.
 *
 * Типы событий не заводятся новые: спонсорство — это подписка, веха
 * спонсорства — продление, подарки — подарки, а суперчат и суперстикер —
 * донат с суммой. Так у стримера уже настроены сценарии, и YouTube попадает в
 * них без единой новой настройки, а донат вдобавок идёт в цель, топ, рулетку и
 * триггеры.
 */
const MAX_MESSAGE = 500;

/**
 * Полученное подаренное спонсорство пропускается — как у Twitch.
 *
 * На пять подаренных спонсорств YouTube шлёт одно `membershipGiftingEvent`
 * дарителя и пять `giftMembershipReceivedEvent` получателей. Показывать и те, и
 * другие значит показать шесть оповещений об одном подарке.
 */
export function normalizeYouTubeChatEvent(
  item: YouTubeChatItem,
  userId: string,
): IncomingAlertEvent | null {
  const snippet = item.snippet;
  if (!snippet?.type || !item.id) return null;

  const username = item.authorDetails?.displayName?.trim();
  const base = {
    userId,
    provider: 'youtube' as const,
    // Id сообщения — он же ключ дедупликации: поток чата переоткрывается с
    // последней страницы, и те же строки приходят второй раз.
    externalId: item.id,
    username: cut(username || 'Зритель', 64),
    amount: null,
    count: null,
    // Голосовых донатов у YouTube нет.
    audioUrl: null,
    isTest: false,
    occurredAt: snippet.publishedAt,
  };

  switch (snippet.type) {
    case 'SUPER_CHAT_EVENT': {
      const details = snippet.superChatDetails;
      if (!details) return null;
      const paid = money(details.amountMicros, details.currency, details.amountDisplayString);
      return {
        ...base,
        type: 'donation',
        amount: paid.amount,
        message: cut(withAmount(details.userComment, paid.shown), MAX_MESSAGE),
      };
    }

    case 'SUPER_STICKER_EVENT': {
      const details = snippet.superStickerDetails;
      if (!details) return null;
      const paid = money(details.amountMicros, details.currency, details.amountDisplayString);
      return {
        ...base,
        type: 'donation',
        amount: paid.amount,
        // У стикера текста нет — вместо него его описание: пустая строка в
        // кадре выглядит как потерянное сообщение.
        message: cut(withAmount(details.superStickerMetadata?.altText, paid.shown), MAX_MESSAGE),
      };
    }

    case 'NEW_SPONSOR_EVENT':
      return {
        ...base,
        type: 'subscription',
        message: cut(snippet.newSponsorDetails?.memberLevelName ?? '', MAX_MESSAGE),
      };

    case 'MEMBER_MILESTONE_CHAT_EVENT': {
      const details = snippet.memberMilestoneChatDetails;
      return {
        ...base,
        type: 'resubscription',
        // Месяцы спонсорства — то же, что месяцы подписки у Twitch: шаблон
        // «с нами {count} мес.» работает и здесь.
        count: whole(details?.memberMonth),
        message: cut(details?.userComment ?? '', MAX_MESSAGE),
      };
    }

    case 'MEMBERSHIP_GIFTING_EVENT': {
      const details = snippet.membershipGiftingDetails;
      return {
        ...base,
        type: 'gift',
        count: whole(details?.giftMembershipsCount),
        message: cut(details?.giftMembershipsLevelName ?? '', MAX_MESSAGE),
      };
    }

    default:
      // Текст, опросы, баны, служебные строки и полученные подарки — не события.
      return null;
  }
}

/**
 * Сумма из микро.
 *
 * Валюта у YouTube любая, а платформа считает в шести (`CURRENCIES`): в
 * тенге и рублях суммы складываются в цель, в йенах — нет. Событие из-за этого
 * не выбрасывается: оно всё равно оповещение. Сумма в незнакомой валюте едет
 * строкой в сообщении — так её видно в кадре и в ленте, хотя в цель она не
 * попадёт.
 */
function money(
  micros: string | number | undefined,
  currency: string | undefined,
  display: string | undefined,
): { amount: IncomingAlertEvent['amount']; shown: string } {
  const value = Number(micros ?? 0);
  if (!Number.isFinite(value) || value <= 0) return { amount: null, shown: '' };
  const code = (currency ?? '').toUpperCase();
  if (!isKnown(code)) return { amount: null, shown: display?.trim() ?? '' };
  return {
    // Микро — миллионные доли основной единицы; минорная единица у всех
    // поддерживаемых валют сотая, поэтому делим на десять тысяч.
    amount: {
      amountMinor: Math.round((value / 1_000_000) * MINOR_UNITS_PER_MAJOR),
      currency: code,
    },
    shown: '',
  };
}

/** Сумма в незнакомой валюте приписывается к сообщению: иначе она пропала бы. */
function withAmount(text: string | undefined, shown: string): string {
  return [shown, text?.trim()].filter((part) => part && part.length > 0).join(' · ');
}

function isKnown(code: string): code is Currency {
  return (CURRENCIES as readonly string[]).includes(code);
}

function whole(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** По кодовым точкам, а не единицам UTF-16: эмодзи не должна разрезаться пополам. */
function cut(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}
