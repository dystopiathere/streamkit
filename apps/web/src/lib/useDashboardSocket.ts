import { useEffect, useRef } from 'react';
import { connectDashboardSocket } from '@/lib/dashboard-socket';

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
  // Обработчик в ref: иначе каждый рендер страницы пересоздавал бы функцию и
  // вместе с ней всё соединение. Присваивание — в эффекте, а не в теле хука:
  // запись в ref во время рендера ломает предположения компилятора React.
  const handlerRef = useRef(onMessage);
  useEffect(() => {
    handlerRef.current = onMessage;
  });

  useEffect(() => {
    const { socket, close } = connectDashboardSocket();
    socket.on(event, (payload: unknown) => handlerRef.current(payload));
    return close;
  }, [event]);
}
