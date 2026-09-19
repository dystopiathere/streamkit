import { type ChatMessage, emoteUrl, type StreamChat } from '@streamkit/contracts';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@streamkit/app-kit';
import { PlatformIcon } from '@streamkit/ui';

/** Насколько близко к низу считается «читаю свежее» — тогда ленту докручиваем сами. */
const STICK_THRESHOLD_PX = 48;

/**
 * Чат в окне эфира.
 *
 * Сообщения не сохраняются нигде — ни у нас, ни в браузере: здесь только то,
 * что пришло, пока окно открыто (соглашение, раздел 13). Поэтому и истории при
 * открытии нет, и об этом сказано прямо под лентой.
 *
 * Лента докручивается вниз, только если стример и так внизу: прокрутил вверх
 * перечитать — новые сообщения не выдёргивают его обратно.
 */
export function ChatPanel({
  chats,
  messages,
  className,
}: {
  chats: StreamChat[];
  messages: ChatMessage[];
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const listRef = useRef<HTMLOListElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const handleScroll = (): void => {
    const list = listRef.current;
    if (!list) return;
    stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_THRESHOLD_PX;
  };

  // Значок площадки у сообщения — только когда площадок несколько: у чата
  // одного Twitch значок на каждой строке — шум.
  const multiPlatform = new Set(chats.map((chat) => chat.platform)).size > 1;

  return (
    <section
      aria-labelledby="stream-chat-title"
      className={cn(
        'flex min-h-0 flex-col rounded-card border border-border bg-surface',
        className,
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h2 id="stream-chat-title" className="font-medium">
          {t('stream.chat.title')}
        </h2>
        {chats.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-xs text-muted">
            {chats.map((chat) => (
              <li
                key={`${chat.platform}:${chat.channel}`}
                className={cn(
                  'flex items-center gap-1.5',
                  (chat.state === 'auth' || chat.state === 'quota') && 'text-danger',
                )}
              >
                <PlatformIcon platform={chat.platform} size={14} />
                <span>
                  {chat.platform === 'twitch'
                    ? t('stream.chat.channelTwitch', { channel: chat.channel })
                    : chat.title}{' '}
                  — {t(`stream.chat.state.${chat.state}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {chats.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          {t('stream.chat.none')}{' '}
          <Link to="/analytics" className="underline hover:text-fg">
            {t('stream.connectPlatform')}
          </Link>
        </p>
      ) : (
        <>
          {/* role="log" без объявлений: чат идёт десятками строк в минуту, и
              скринридер, читающий каждую, сделал бы остальную страницу
              недоступной. Ленту можно прочитать, перейдя в неё. */}
          <ol
            ref={listRef}
            onScroll={handleScroll}
            role="log"
            aria-live="off"
            aria-label={t('stream.chat.label')}
            tabIndex={0}
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3 text-sm"
          >
            {messages.length === 0 ? (
              <li className="text-muted">{t('stream.chat.waiting')}</li>
            ) : null}
            {messages.map((message) => (
              <li key={message.id} className="break-words">
                {multiPlatform ? (
                  <PlatformIcon
                    platform={message.platform}
                    size={14}
                    style={{ marginRight: 6, verticalAlign: '-2px' }}
                  />
                ) : null}
                <span className="font-semibold">{message.username}</span>
                <span className="text-muted">: </span>
                {message.parts.map((part, index) =>
                  part.kind === 'text' ? (
                    <span key={index}>{part.value}</span>
                  ) : (
                    <img
                      key={index}
                      src={emoteUrl(part.id, 1)}
                      alt={part.alt}
                      title={part.alt}
                      className="mx-0.5 inline-block h-6 w-auto align-middle"
                    />
                  ),
                )}
              </li>
            ))}
          </ol>
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            {t('stream.chat.notStored')}
          </p>
        </>
      )}
    </section>
  );
}
