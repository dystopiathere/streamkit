import { io, type Socket } from 'socket.io-client';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { SOCKET_URL } from '@/lib/config';

/** Пауза перед новой попыткой, когда API не ответил на обновление токена. */
const RETRY_MS = 5_000;

export interface DashboardSocket {
  socket: Socket;
  /** Закрыть соединение и отменить отложенное переподключение. */
  close: () => void;
}

/**
 * Сокет дашборда, который переживает истечение access-токена.
 *
 * Сервер закрывает соединение в момент, когда истекает токен, по которому оно
 * открыто: иначе сокет окна эфира переживал бы выход и смену пароля. На такой
 * разрыв socket.io сам не переподключается — это делает клиент, получив новый
 * токен. Отказ в обновлении очищает сессию, и приложение уходит на вход.
 *
 * Токен читается из хранилища на каждое подключение, а не держится в
 * замыкании: к переподключению прежний уже истёк.
 */
export function connectDashboardSocket(): DashboardSocket {
  const socket = io(`${SOCKET_URL}/dashboard`, {
    transports: ['websocket'],
    auth: (cb: (data: { token: string | null }) => void) =>
      cb({ token: useAuthStore.getState().accessToken }),
  });

  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const reconnect = async (): Promise<void> => {
    const outcome = await api.refreshSession();
    if (closed) return;
    if (outcome === 'refreshed') socket.connect();
    else if (outcome === 'unavailable') retry = setTimeout(() => void reconnect(), RETRY_MS);
  };

  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') void reconnect();
  });

  return {
    socket,
    close: () => {
      closed = true;
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
