import {
  type ChatMessage,
  type ChatWidgetConfig,
  emoteUrl,
  type ChatPart,
} from '@streamkit/contracts';
import { textStyleToCss } from './text-style';

export interface ChatBoxProps {
  config: ChatWidgetConfig;
  /** Сообщения в порядке прихода: самое свежее последним. */
  messages: ChatMessage[];
}

/**
 * Чат в кадре.
 *
 * Фильтры применяются ЗДЕСЬ, а не на сервере, и это отличие от порога алертов.
 * Порог там серверный потому, что донат ниже порога не должен доехать до
 * публичной страницы вообще. Фильтры чата косметические — боты и команды, — а
 * комната доставки общая на канал: два виджета одного стримера вправе прятать
 * разные ники, и серверный фильтр потребовал бы комнату на каждый виджет.
 */
export function ChatBox({ config, messages }: ChatBoxProps): React.JSX.Element | null {
  const visible = messages
    .filter((message) => isVisible(message, config))
    .slice(-config.maxMessages);
  if (visible.length === 0) return null;

  const text = textStyleToCss(config.text);
  const rows = config.newestFirst ? [...visible].reverse() : visible;

  return (
    <div
      data-testid="chat-box"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: '100%',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      {rows.map((message) => (
        <div
          key={message.id}
          style={{
            ...text,
            fontSize: config.text.fontSize,
            lineHeight: 1.25,
            overflowWrap: 'anywhere',
          }}
        >
          {config.showBadges && message.badges.length > 0 ? (
            <span style={{ opacity: 0.75, marginRight: 6 }}>
              {message.badges.map((badge) => BADGE_SIGNS[badge]).join('')}
            </span>
          ) : null}

          <span
            style={{
              fontWeight: 700,
              // Цвет из тега, если стример не попросил единый: ник своего цвета
              // зритель узнаёт быстрее, чем читает.
              color: config.useAuthorColors
                ? (message.color ?? config.text.highlightColor)
                : config.text.highlightColor,
            }}
          >
            {message.username}
          </span>
          <span style={{ opacity: 0.7 }}>: </span>
          {message.parts.map((part, index) => (
            <Part key={index} part={part} config={config} size={config.text.fontSize} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Part({
  part,
  config,
  size,
}: {
  part: ChatPart;
  config: ChatWidgetConfig;
  size: number;
}): React.JSX.Element {
  if (part.kind === 'text' || !config.showEmotes) {
    // Текст вставляется текстом. Разметка из пользовательского сообщения на
    // публичной странице поверх эфира — прямой XSS-вектор.
    return <span>{part.kind === 'text' ? part.value : part.alt}</span>;
  }

  return (
    <img
      src={emoteUrl(part.id)}
      // Подпись обязательна: в браузер-сорсе OBS картинка может не догрузиться,
      // и пустое место посреди фразы хуже, чем слово «Kappa».
      alt={part.alt}
      style={{ height: Math.round(size * 1.1), verticalAlign: 'middle', margin: '0 2px' }}
    />
  );
}

/**
 * Значки — символами, а не картинками.
 *
 * Картинки значков лежат в отдельном API Twitch, у каждого канала свой набор, и
 * ради подписчицких месяцев пришлось бы ходить за ним по OAuth. Символ говорит
 * ровно то же самое и ничего не стоит.
 */
const BADGE_SIGNS: Record<string, string> = {
  broadcaster: '🎥',
  moderator: '🗡',
  vip: '💎',
  subscriber: '★',
  founder: '☆',
  artist: '🎨',
  partner: '✔',
  staff: '🛠',
  turbo: '⚡',
  premium: '👑',
};

function isVisible(message: ChatMessage, config: ChatWidgetConfig): boolean {
  if (config.hiddenUsers.includes(message.login)) return false;
  if (config.hideCommands && startsWithCommand(message)) return false;
  return true;
}

function startsWithCommand(message: ChatMessage): boolean {
  const first = message.parts[0];
  return first?.kind === 'text' && first.value.trimStart().startsWith('!');
}
