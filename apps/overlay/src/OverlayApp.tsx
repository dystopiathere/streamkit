import {
  type AlertEvent,
  type AlertWidgetConfig,
  type ChatMessage,
  type ConfigUpdatedMessage,
  type OverlayBootstrap,
  type WidgetState,
  defaultWidgetConfig,
  shouldShowAlert,
} from '@streamkit/contracts';
import {
  ALERT_EXIT_DURATION_MS,
  AlertAnimationStyles,
  AlertCard,
  ChatBox,
  GoalBar,
  TimerDisplay,
  TopDonorsList,
  exitAnimationName,
  useAlertQueue,
} from '@streamkit/ui';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { readTokenFromLocation, useOverlayConnection } from './useOverlayConnection';

const token = readTokenFromLocation();

/**
 * Гости комнаты — отдельным чанком: клиент WebRTC тяжелее всего остального
 * оверлея, и сцене с оповещениями платить за него загрузкой незачем.
 */
const GuestsOverlay = lazy(async () => ({
  default: (await import('./GuestsOverlay')).GuestsOverlay,
}));

/**
 * Сколько сообщений чата держим в памяти.
 *
 * Заметно больше потолка виджета: фильтры срабатывают уже после буфера, и
 * обрезка ровно по maxMessages оставляла бы на экране меньше строк, чем просил
 * стример. Полсотни строк — это доли килобайта.
 */
const CHAT_BUFFER = 60;

/** Дефолт алертов нужен очереди с первой секунды — до прихода bootstrap. */
const DEFAULT_ALERT_CONFIG = defaultWidgetConfig('alerts').config as AlertWidgetConfig;

/**
 * Оверлей для браузер-сорса OBS.
 *
 * Тип виджета приходит с сервера вместе с конфигом: ссылка ведёт на конкретный
 * виджет, а какой он — знает только БД. Раньше тип был ровно один, и его можно
 * было не передавать вовсе.
 */
export function OverlayApp(): React.JSX.Element | null {
  const [widget, setWidget] = useState<OverlayBootstrap | null>(null);
  const [state, setState] = useState<WidgetState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const alertConfig = widget?.type === 'alerts' ? widget.config : DEFAULT_ALERT_CONFIG;
  const { current, enqueue } = useAlertQueue(alertConfig);

  const handleAlert = useCallback(
    (event: AlertEvent) => {
      // Фильтр уже применён на сервере. Проверяем повторно, потому что конфиг мог
      // поменяться в момент доставки, а показать донат ниже порога — значит
      // показать зрителям то, что стример просил не показывать.
      if (!shouldShowAlert(event, alertConfig)) return;
      enqueue(event);
    },
    [alertConfig, enqueue],
  );

  const handleBootstrap = useCallback((bootstrap: OverlayBootstrap) => {
    setWidget(bootstrap);
    setState(bootstrap.state);
  }, []);

  /**
   * Настройки поменялись — состояние остаётся прежним.
   *
   * Это не мелочь: правка заголовка цели во время эфира не должна обнулять
   * собранную сумму на экране. Пересчитанное состояние приедет своим
   * сообщением, если настройки на него повлияли.
   */
  const handleConfig = useCallback((next: ConfigUpdatedMessage) => {
    setWidget((current) => (current ? { ...current, ...next } : current));
  }, []);

  const handleState = useCallback((next: WidgetState) => setState(next), []);

  /**
   * Лента чата.
   *
   * Буфер обрезается с запасом над `maxMessages`: виджет показывает последние
   * строки, но фильтры (боты, команды) отсекают часть уже после буфера, и
   * обрезка ровно по `maxMessages` оставляла бы на экране меньше строк, чем
   * просил стример. Дубли по идентификатору — от переподключения.
   */
  const handleChat = useCallback((next: ChatMessage) => {
    setMessages((current) =>
      current.some((message) => message.id === next.id)
        ? current
        : [...current, next].slice(-CHAT_BUFFER),
    );
  }, []);

  const handlers = useMemo(
    () => ({
      onAlert: handleAlert,
      onBootstrap: handleBootstrap,
      onConfig: handleConfig,
      onState: handleState,
      onChat: handleChat,
    }),
    [handleAlert, handleBootstrap, handleConfig, handleState, handleChat],
  );

  const connection = useOverlayConnection(token, handlers);

  // Никаких сообщений об ошибках на экране: любой текст попадёт в эфир. Проблемы
  // видны в дашборде (оверлей не отмечался как активный) и в консоли браузера.
  if (connection === 'invalid-token' || connection === 'revoked') return null;
  if (!widget || !widget.isEnabled) return null;

  switch (widget.type) {
    case 'alerts':
      return (
        <>
          <AlertAnimationStyles />
          {current ? (
            <div
              key={current.event.id}
              style={{
                width: '100%',
                height: '100%',
                animation: current.isLeaving
                  ? `${exitAnimationName(widget.config.animationOut)} ${ALERT_EXIT_DURATION_MS}ms ease-in both`
                  : undefined,
              }}
            >
              <AlertCard
                event={current.event}
                config={widget.config}
                animate={!current.isLeaving}
              />
            </div>
          ) : null}
        </>
      );

    // Состояние приходит отдельным сообщением и приезжает уже в bootstrap.
    // Пока его нет, рендерим с пустым состоянием: пустая полоса честнее, чем
    // мигающая заглушка поверх эфира.
    case 'goal':
      return <GoalBar config={widget.config} state={state?.kind === 'goal' ? state : null} />;

    case 'timer':
      return <TimerDisplay config={widget.config} state={state?.kind === 'timer' ? state : null} />;

    case 'top-donors':
      return (
        <TopDonorsList config={widget.config} state={state?.kind === 'top-donors' ? state : null} />
      );

    // Гости выводятся из комнаты LiveKit, а не из сокета оверлея: сокет
    // сообщает только, какая комната выбрана, медиа идёт напрямую с медиасервера.
    case 'guests':
      return token ? (
        <Suspense fallback={null}>
          <GuestsOverlay overlayToken={token} config={widget.config} />
        </Suspense>
      ) : null;

    // Сообщения приезжают отдельным потоком, а не состоянием: у чата нечего
    // пересчитывать, есть только лента, и накапливает её сам оверлей.
    //
    // Буфер фильтруется по текущему каналу. Смена канала в настройках переселяет
    // сокет в новую комнату, но строки старого канала остаются в буфере — и без
    // фильтра висели бы под новым, а на тихом канале при негаснущих сообщениях
    // часами.
    case 'chat': {
      const channel = widget.config.channel;
      return (
        <ChatBox
          config={widget.config}
          messages={messages.filter((message) => message.channel === channel)}
        />
      );
    }
  }
}
