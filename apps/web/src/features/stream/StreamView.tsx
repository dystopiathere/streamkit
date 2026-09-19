import {
  type AlertEvent,
  type ChatMessage,
  chatChannelKey,
  type StreamChat,
} from '@streamkit/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@streamkit/app-kit';
import { useRecentEvents } from '@/features/widgets/queries';
import { ChatPanel } from './ChatPanel';
import { RecentEvents } from './RecentEvents';
import { applyChannelStats, useStreamOverview } from './queries';
import { StreamStatus } from './StreamStatus';
import { StreamWidgets } from './StreamWidgets';
import { useStreamSocket } from './useStreamSocket';

/** Сколько строк чата держим. Больше за эфир не перечитывают, а DOM растёт. */
const CHAT_BUFFER = 200;
/** Сколько событий показываем. Остальные — в ленте «События». */
const EVENTS_SHOWN = 10;

/**
 * Окно эфира: состояние стрима, чат, последние события и виджеты.
 *
 * Одно и то же в двух обёртках — страницей дашборда и отдельным окном без
 * меню, которое держат рядом с игрой или добавляют в OBS док-панелью.
 */
export function StreamView({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const overview = useStreamOverview();
  const history = useRecentEvents();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveEvents, setLiveEvents] = useState<AlertEvent[]>([]);
  // undefined — сервер ещё не ответил на подписку, берём каналы из сводки.
  const [chats, setChats] = useState<StreamChat[] | undefined>(undefined);
  const chatKeysRef = useRef<string | undefined>(undefined);

  useStreamSocket({
    onChat: (message) => setMessages((current) => [...current, message].slice(-CHAT_BUFFER)),
    onEvent: (event) => {
      setLiveEvents((current) => [event, ...current].slice(0, EVENTS_SHOWN));
      void queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onStats: (channelId, stats) => applyChannelStats(queryClient, channelId, stats),
    onWatch: (next) => {
      // Каналы сменились (подключили или отключили площадку) — строки
      // канала, которого больше нет, убираем. Состояние чтения меняется
      // каждое напоминание, а ленту трогаем только при смене состава.
      const keys = next.map((chat) => chatChannelKey(chat));
      if (chatKeysRef.current !== undefined && chatKeysRef.current !== keys.join(' ')) {
        const kept = new Set(keys);
        setMessages((current) => current.filter((message) => kept.has(chatChannelKey(message))));
      }
      chatKeysRef.current = keys.join(' ');
      setChats(next);
    },
  });

  // Живые события первыми, дубли из перезапрошенной истории — по id.
  const seen = new Set<string>();
  const events = [...liveEvents, ...(history.data?.items ?? [])]
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .slice(0, EVENTS_SHOWN);

  if (overview.isLoading) {
    return (
      <p role="status" className="text-muted">
        {t('common.loading')}
      </p>
    );
  }
  if (!overview.data) {
    return (
      <p role="alert" className="text-danger">
        {t('common.error')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <StreamStatus channels={overview.data.channels} compact={compact} />
      <div
        className={cn(
          'grid gap-4',
          compact ? 'grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]',
        )}
      >
        <ChatPanel
          chats={chats ?? overview.data.chats}
          messages={messages}
          className={compact ? 'h-[55vh] min-h-72' : 'h-[65vh] min-h-96'}
        />
        <div className="space-y-4">
          <RecentEvents events={events} />
          <StreamWidgets widgets={overview.data.widgets} />
        </div>
      </div>
    </div>
  );
}
