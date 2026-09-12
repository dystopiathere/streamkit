import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '@/lib/auth-store';
import { SOCKET_URL } from '@/lib/config';

type Handler = (payload: unknown) => void;

/**
 * Подписка на событие сокета дашборда.
 *
 * Вынесено из `EventsPage` ради второго потребителя: воркер публикует свежие
 * метрики каналов в шину, шлюз рассылает их в комнату пользователя — а слушать
 * их было некому. Страница «Аналитика» показывала число зрителей на момент
 * открытия вкладки и не обновляла его, пока стример не перезагрузит страницу:
 * `staleTime` тридцать секунд, а `refetchOnWindowFocus` в этом приложении
 * выключен намеренно.
 *
 * Соединение своё на каждый вызов хука. Это осознанно: страниц дашборда,
 * которым нужен сокет, две, они не открыты одновременно, а общий мультиплексор
 * потребовал бы контекста и учёта подписчиков ради экономии одного соединения.
 */
export function useDashboardSocket(event: string, onMessage: Handler): void {
  /**
   * Токен читается в ref, а не через подписку на стор.
   *
   * Подписка сделала бы его зависимостью эффекта, а access-токен меняется при
   * каждом обновлении пары — примерно раз в 15 минут. Эффект перезапускался бы,
   * сокет рвался и переподключался, и всё пришедшее в это окно терялось.
   */
  const tokenRef = useRef(useAuthStore.getState().accessToken);
  useEffect(() => useAuthStore.subscribe((state) => (tokenRef.current = state.accessToken)), []);

  // Обработчик тоже в ref: иначе каждый рендер страницы пересоздавал бы функцию
  // и вместе с ней всё соединение. Присваивание — в эффекте, а не в теле хука:
  // запись в ref во время рендера ломает предположения компилятора React.
  const handlerRef = useRef(onMessage);
  useEffect(() => {
    handlerRef.current = onMessage;
  });

  useEffect(() => {
    const socket = io(`${SOCKET_URL}/dashboard`, {
      transports: ['websocket'],
      // Функция, а не объект: при каждом переподключении сокет спрашивает токен
      // заново и получает актуальный, а не тот, что был на момент монтирования.
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: tokenRef.current }),
    });

    socket.on(event, (payload: unknown) => handlerRef.current(payload));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [event]);
}
