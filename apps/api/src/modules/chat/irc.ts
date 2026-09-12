import {
  CHAT_BADGES,
  type ChatBadge,
  type ChatMessage,
  type EmoteRange,
  splitEmotes,
} from '@streamkit/contracts';

/**
 * Разобранная строка IRC.
 *
 * Отдельно от сокета намеренно: весь протокол — это разбор текста, и проверять
 * его удобнее без сети. Все грабли ниже живут именно здесь и покрыты тестами.
 */
export interface IrcLine {
  tags: Record<string, string>;
  /** Отправитель: `nick!user@host`. Для служебных команд сервера его нет. */
  prefix: string | null;
  command: string;
  /** Параметры; последний — «хвост» после двоеточия, если он был. */
  params: string[];
}

/**
 * Обратное экранирование значений тегов IRCv3.
 *
 * Без него ник с пробелом приезжает как `Иван\sПетров`, а сообщение с точкой с
 * запятой рвётся на два тега. Правила заданы спецификацией и выглядят
 * неочевидно: `\s` это пробел, а `\:` — точка с запятой, а не двоеточие.
 */
function unescapeTag(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\\') {
      result += value[index];
      continue;
    }
    const next = value[index + 1];
    index += 1;
    switch (next) {
      case ':':
        result += ';';
        break;
      case 's':
        result += ' ';
        break;
      case '\\':
        result += '\\';
        break;
      case 'r':
        result += '\r';
        break;
      case 'n':
        result += '\n';
        break;
      case undefined:
        // Обратный слэш в конце значения спецификация велит выбросить.
        break;
      default:
        result += next;
    }
  }
  return result;
}

/** @returns null, если строка пустая или не похожа на IRC. */
export function parseIrcLine(line: string): IrcLine | null {
  let rest = line.trim();
  if (rest.length === 0) return null;

  const tags: Record<string, string> = {};
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ');
    if (space < 0) return null;
    for (const pair of rest.slice(1, space).split(';')) {
      if (pair.length === 0) continue;
      const equals = pair.indexOf('=');
      const key = equals < 0 ? pair : pair.slice(0, equals);
      tags[key] = equals < 0 ? '' : unescapeTag(pair.slice(equals + 1));
    }
    rest = rest.slice(space + 1);
  }

  let prefix: string | null = null;
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ');
    if (space < 0) return null;
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }

  const params: string[] = [];
  while (rest.length > 0) {
    if (rest.startsWith(':')) {
      // Хвост забирает всё до конца строки вместе с пробелами.
      params.push(rest.slice(1));
      break;
    }
    const space = rest.indexOf(' ');
    if (space < 0) {
      params.push(rest);
      break;
    }
    params.push(rest.slice(0, space));
    rest = rest.slice(space + 1);
  }

  const command = params.shift();
  if (!command) return null;
  return { tags, prefix, command: command.toUpperCase(), params };
}

const KNOWN_BADGES = new Set<string>(CHAT_BADGES);

/**
 * Значки автора.
 *
 * Список значков Twitch открыт и пополняется — значки подписок на месяцы,
 * значки событий, партнёрские программы. Неизвестные молча отбрасываются:
 * ронять сообщение из-за нового значка означало бы, что чат в эфире замолкает
 * в день, когда Twitch что-то придумал.
 */
export function parseBadges(tag: string | undefined): ChatBadge[] {
  if (!tag) return [];
  const badges: ChatBadge[] = [];
  for (const entry of tag.split(',')) {
    const name = entry.split('/')[0];
    if (name && KNOWN_BADGES.has(name) && !badges.includes(name as ChatBadge)) {
      badges.push(name as ChatBadge);
    }
  }
  return badges.slice(0, 8);
}

/** Тег `emotes`: `25:0-4,12-16/1902:6-10`. Позиции — в кодовых точках. */
export function parseEmotes(tag: string | undefined): EmoteRange[] {
  if (!tag) return [];
  const ranges: EmoteRange[] = [];

  for (const group of tag.split('/')) {
    const colon = group.indexOf(':');
    if (colon < 0) continue;
    const id = group.slice(0, colon);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;

    for (const span of group.slice(colon + 1).split(',')) {
      const [from, to] = span.split('-');
      const start = Number(from);
      const end = Number(to);
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
      ranges.push({ id, start, end });
    }
  }
  return ranges;
}

/** Ник из префикса `nick!user@host`. */
function loginFromPrefix(prefix: string | null): string | null {
  if (!prefix) return null;
  const bang = prefix.indexOf('!');
  const login = (bang < 0 ? prefix : prefix.slice(0, bang)).toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(login) ? login : null;
}

/**
 * Обёртка команды `/me`.
 *
 * Текст приезжает внутри управляющих символов (0x01) со словом ACTION впереди.
 * Без снятия обёртки зрители видят в кадре служебный мусор вокруг фразы.
 *
 * Управляющие символы в регулярке здесь и есть цель, а не недосмотр: правило
 * no-control-regex защищает от случайно вставленного символа, а этот символ
 * задан спецификацией протокола.
 */
// eslint-disable-next-line no-control-regex
const ACTION = new RegExp('^\u0001ACTION (.*)\u0001$');

/**
 * PRIVMSG → сообщение чата в форме контракта.
 *
 * @returns null, если это не сообщение пользователя или разобрать его нечем.
 */
export function toChatMessage(line: IrcLine, fallbackNow: Date = new Date()): ChatMessage | null {
  if (line.command !== 'PRIVMSG') return null;

  const channel = line.params[0]?.replace(/^#/, '').toLowerCase();
  const raw = line.params[1];
  const login = loginFromPrefix(line.prefix);
  if (!channel || raw === undefined || !login) return null;

  const text = ACTION.exec(raw)?.[1] ?? raw;

  // Метка времени от площадки, а не наша: сообщение могло полежать в очереди
  // переподключения, и порядок в ленте обязан остаться авторским.
  const sentTs = Number(line.tags['tmi-sent-ts']);
  const sentAt = Number.isFinite(sentTs) && sentTs > 0 ? new Date(sentTs) : fallbackNow;

  const color = line.tags.color;
  return {
    id: line.tags.id || `${login}-${sentAt.getTime()}`,
    platform: 'twitch',
    channel,
    login,
    username: line.tags['display-name']?.trim() || login,
    color: color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : null,
    badges: parseBadges(line.tags.badges),
    parts: splitEmotes(text, parseEmotes(line.tags.emotes)),
    sentAt: sentAt.toISOString(),
  };
}
