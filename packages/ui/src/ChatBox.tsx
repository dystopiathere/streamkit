import {
  type ChatMessage,
  type ChatWidgetConfig,
  emoteUrl,
  type ChatPart,
} from '@streamkit/contracts';
import { useEffect, useState } from 'react';
import { PlatformIcon } from './PlatformIcon';
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
  const clock = useFadeClock(messages, config.messageLifetimeSeconds);

  const visible = messages
    .filter((message) => isVisible(message, config) && !isFaded(message, config, clock))
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
          {config.showPlatform !== false ? (
            <PlatformIcon
              platform={message.platform}
              size={Math.round(config.text.fontSize * 0.8)}
              style={{ marginRight: 6, verticalAlign: 'middle' }}
            />
          ) : null}
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
  member: '★',
  verified: '✔',
};

interface FadeClock {
  now: number;
  /** На сколько часы машины с OBS расходятся с часами площадки. */
  skewMs: number;
}

/**
 * Часы для гашения строк.
 *
 * Время живёт в состоянии и двигается только из таймера: `Date.now()` в теле
 * компонента делает рендер нечистым, и линтер React Compiler это ловит.
 *
 * Поправка на расхождение часов считается по САМОМУ СВЕЖЕМУ сообщению. Метка
 * времени в сообщении — серверная, а часы машины с OBS уезжают на что угодно:
 * убежавшие вперёд заставили бы чат гаснуть мгновенно, отставшие — не гаснуть
 * никогда, и заметить это можно только сравнив с чужим экраном. Свежее
 * сообщение по определению только что отправлено, поэтому разница между его
 * меткой и местным временем и есть расхождение.
 */
function useFadeClock(messages: ChatMessage[], lifetimeSeconds: number): FadeClock {
  const newest = messages.at(-1);
  const newestSentAt = newest?.sentAt;
  const [clock, setClock] = useState<FadeClock>(() => ({ now: Date.now(), skewMs: 0 }));

  useEffect(() => {
    if (lifetimeSeconds === 0) return;

    const skewMs = newestSentAt ? Date.now() - Date.parse(newestSentAt) : 0;
    const apply = (): void => setClock({ now: Date.now(), skewMs });

    // Первый пересчёт через setTimeout(0), а не сразу: синхронный setState
    // внутри эффекта запускает каскад лишних рендеров.
    const immediate = setTimeout(apply, 0);
    const interval = setInterval(apply, 1000);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [newestSentAt, lifetimeSeconds]);

  return clock;
}

function isFaded(message: ChatMessage, config: ChatWidgetConfig, clock: FadeClock): boolean {
  if (config.messageLifetimeSeconds === 0) return false;
  const ageMs = clock.now - clock.skewMs - Date.parse(message.sentAt);
  return ageMs > config.messageLifetimeSeconds * 1000;
}

function isVisible(message: ChatMessage, config: ChatWidgetConfig): boolean {
  // Площадка выключена в настройках. `?.`: конфиг из предпросмотра может быть
  // собран до того, как схема досыпала новое поле.
  if (config.platforms?.[message.platform] === false) return false;
  // Список скрытых сверяется и с логином, и с именем: у YouTube постоянный
  // идентификатор — id канала, которого стример не знает, а боты узнаются по
  // имени. Имя приводится так же, как значение в списке, — без регистра и «@».
  const name = message.username.trim().toLowerCase().replace(/^@/, '');
  if (config.hiddenUsers.includes(message.login.toLowerCase())) return false;
  if (config.hiddenUsers.includes(name)) return false;
  if (config.hideCommands && startsWithCommand(message)) return false;
  return true;
}

function startsWithCommand(message: ChatMessage): boolean {
  const first = message.parts[0];
  return first?.kind === 'text' && first.value.trimStart().startsWith('!');
}
