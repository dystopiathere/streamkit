import {
  type AlertEvent,
  alertEventSchema,
  type ChannelStats,
  channelStatsSchema,
  type ChatMessage,
  chatMessageSchema,
  SOCKET_EVENTS,
  type StreamChat,
  streamWatchAckSchema,
} from '@streamkit/contracts';
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '@/lib/auth-store';
import { SOCKET_URL } from '@/lib/config';

/** Как часто окно напоминает серверу, что оно открыто. Отметка живёт 90 секунд. */
const WATCH_INTERVAL_MS = 30_000;

export interface StreamSocketHandlers {
  onChat: (message: ChatMessage) => void;
  onEvent: (event: AlertEvent) => void;
  onStats: (channelId: string, stats: ChannelStats) => void;
  /** Какой чат сервер назначил окну. Приходит на каждое напоминание. */
  onWatch: (chat: StreamChat | null) => void;
}

/**
 * Сокет окна эфира: чат, события и метрики одним соединением.
 *
 * Отдельно от `useDashboardSocket`, а не три его вызова: окну нужно ещё и
 * повторять `stream:watch`, пока оно открыто, — по этой отметке воркер держит
 * чат канала. Токен и обработчики — в ref, по той же причине, что там: иначе
 * соединение рвалось бы при каждом обновлении токена и каждом рендере.
 */
export function useStreamSocket(handlers: StreamSocketHandlers): void {
  const tokenRef = useRef(useAuthStore.getState().accessToken);
  useEffect(() => useAuthStore.subscribe((state) => (tokenRef.current = state.accessToken)), []);

  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const socket = io(`${SOCKET_URL}/dashboard`, {
      transports: ['websocket'],
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: tokenRef.current }),
    });

    const watch = (): void => {
      socket.emit(SOCKET_EVENTS.streamWatch, (ack: unknown) => {
        const parsed = streamWatchAckSchema.safeParse(ack);
        if (parsed.success) handlersRef.current.onWatch(parsed.data.chat);
      });
    };
    // Каждое подключение — заново: после обрыва сокет вошёл без комнаты чата.
    socket.on('connect', watch);
    const timer = setInterval(() => {
      if (socket.connected) watch();
    }, WATCH_INTERVAL_MS);

    socket.on(SOCKET_EVENTS.chatMessage, (payload: unknown) => {
      const parsed = chatMessageSchema.safeParse(payload);
      if (parsed.success) handlersRef.current.onChat(parsed.data);
    });
    socket.on(SOCKET_EVENTS.eventCreated, (payload: unknown) => {
      const parsed = alertEventSchema.safeParse((payload as { event?: unknown } | null)?.event);
      if (parsed.success) handlersRef.current.onEvent(parsed.data);
    });
    socket.on(SOCKET_EVENTS.analyticsUpdated, (payload: unknown) => {
      const message = payload as { channelId?: unknown; stats?: unknown } | null;
      const stats = channelStatsSchema.safeParse(message?.stats);
      if (typeof message?.channelId === 'string' && stats.success) {
        handlersRef.current.onStats(message.channelId, stats.data);
      }
    });

    return () => {
      clearInterval(timer);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
}
