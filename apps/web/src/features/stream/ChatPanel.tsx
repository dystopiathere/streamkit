import { type ChatMessage, emoteUrl, type StreamChat } from '@streamkit/contracts';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@streamkit/app-kit';

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
  chat,
  messages,
  className,
}: {
  chat: StreamChat | null;
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

  // Площадка у сообщения подписывается, только когда их несколько: у чата
  // одного Twitch метка «twitch» на каждой строке — шум.
  const multiPlatform = new Set(messages.map((message) => message.platform)).size > 1;

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
        {chat ? (
          <p className="text-xs text-muted">
            {t(`stream.chat.source.${chat.source}`, { channel: chat.channel })}
          </p>
        ) : null}
      </header>

      {chat === null ? (
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
                  <span className="mr-1.5 text-xs text-muted uppercase">{message.platform}</span>
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
