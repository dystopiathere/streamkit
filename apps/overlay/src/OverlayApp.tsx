import {
  type AlertEvent,
  type AlertWidgetConfig,
  type OverlayBootstrap,
  defaultWidgetConfig,
  shouldShowAlert,
} from '@streamkit/contracts';
import {
  ALERT_EXIT_DURATION_MS,
  AlertAnimationStyles,
  AlertCard,
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

  const handleBootstrap = useCallback((bootstrap: OverlayBootstrap) => setWidget(bootstrap), []);

  const handlers = useMemo(
    () => ({ onAlert: handleAlert, onBootstrap: handleBootstrap }),
    [handleAlert, handleBootstrap],
  );

  const connection = useOverlayConnection(token, handlers);

  // Никаких сообщений об ошибках на экране: любой текст попадёт в эфир. Проблемы
  // видны в дашборде (оверлей не отмечался как активный) и в консоли браузера.
  if (connection === 'invalid-token' || connection === 'revoked') return null;
  if (!widget || !widget.isEnabled) return null;

  // Остальные типы уже принимаются сервером, но рендерера у них пока нет.
  // Пустой экран здесь честнее заглушки: оверлей висит поверх живого эфира.
  if (widget.type !== 'alerts') return null;

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
          <AlertCard event={current.event} config={widget.config} animate={!current.isLeaving} />
        </div>
      ) : null}
    </>
  );
}
