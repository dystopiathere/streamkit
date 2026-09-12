import {
  type AlertEvent,
  type AlertWidgetConfig,
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
  GoalBar,
  TimerDisplay,
  TopDonorsList,
  exitAnimationName,
  useAlertQueue,
} from '@streamkit/ui';
import { useCallback, useMemo, useState } from 'react';
import { readTokenFromLocation, useOverlayConnection } from './useOverlayConnection';

const token = readTokenFromLocation();

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

  const handlers = useMemo(
    () => ({
      onAlert: handleAlert,
      onBootstrap: handleBootstrap,
      onConfig: handleConfig,
      onState: handleState,
    }),
    [handleAlert, handleBootstrap, handleConfig, handleState],
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
  }
}
