import {
  type AlertEvent,
  type OverlayBootstrap,
  SOCKET_EVENTS,
  alertEventSchema,
  overlayBootstrapSchema,
} from '@streamkit/contracts';
import { useEffect, useRef, useState } from 'react';
import { type Socket, io } from 'socket.io-client';

export type ConnectionState = 'connecting' | 'connected' | 'revoked' | 'invalid-token';

export interface OverlayConnectionHandlers {
  onAlert: (event: AlertEvent) => void;
  onBootstrap: (bootstrap: OverlayBootstrap) => void;
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * Соединение overlay с сервером.
 *
 * Переподключение отдано socket.io: OBS держит страницу открытой часами, и за
 * это время сеть обрывается не раз. Сцену никто не перезагружает вручную, так
 * что бесконечные попытки — правильное поведение.
 *
 * Исключение — отозванный токен: тут переподключаться бессмысленно, сервер будет
 * отвергать каждую попытку. Поэтому по `revoked` соединение закрывается навсегда.
 */
export function useOverlayConnection(
  token: string | null,
  handlers: OverlayConnectionHandlers,
): ConnectionState {
  // Начальное состояние вычисляется сразу, а не выставляется из эффекта:
  // синхронный setState в эффекте вызывает лишний каскад рендеров.
  const [state, setState] = useState<ConnectionState>(token ? 'connecting' : 'invalid-token');

  // Колбэки держим в ref и обновляем в эффекте: иначе каждый рендер
  // пересоздавал бы сокет, а запись в ref во время рендера ломает правила хуков.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!token) return;

    const socket: Socket = io(`${API_URL}/overlay`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    let revoked = false;

    socket.on('connect', () => setState('connected'));

    socket.on('disconnect', () => {
      if (!revoked) setState('connecting');
    });

    socket.on(SOCKET_EVENTS.configUpdated, (payload: unknown) => {
      // Сервер валидирует то, что отправляет, но overlay живёт неделями и может
      // пережить деплой с другой формой конфига. Мусор лучше проигнорировать,
      // чем упасть посреди стрима.
      const parsed = overlayBootstrapSchema.safeParse(payload);
      if (parsed.success) {
        handlersRef.current.onBootstrap(parsed.data);
      }
    });

    socket.on(SOCKET_EVENTS.alert, (payload: unknown) => {
      const parsed = alertEventSchema.safeParse((payload as { event?: unknown })?.event);
      if (parsed.success) {
        handlersRef.current.onAlert(parsed.data);
      }
    });

    socket.on(SOCKET_EVENTS.revoked, () => {
      revoked = true;
      setState('revoked');
      socket.disconnect();
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [token]);

  return state;
}

/** Токен берётся из query: другого способа передать его в браузер-сорс OBS нет. */
export function readTokenFromLocation(): string | null {
  const token = new URLSearchParams(window.location.search).get('token');
  return token && token.length > 0 ? token : null;
}
