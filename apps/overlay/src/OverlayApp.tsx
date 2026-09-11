import {
  type AlertEvent,
  type OverlayBootstrap,
  defaultAlertWidgetConfig,
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

export function OverlayApp(): React.JSX.Element | null {
  // До прихода конфига с сервера работаем на дефолтах: длительности нужны
  // очереди с первой секунды, а реальный конфиг приезжает сразу после подключения.
  const [config, setConfig] = useState(defaultAlertWidgetConfig);
  const [isEnabled, setIsEnabled] = useState(true);

  const { current, enqueue } = useAlertQueue(config);

  const handleAlert = useCallback(
    (event: AlertEvent) => {
      // Фильтр уже применён на сервере. Проверяем повторно, потому что конфиг мог
      // поменяться в момент доставки, а показать донат ниже порога — значит
      // показать зрителям то, что стример просил не показывать.
      if (!shouldShowAlert(event, config)) return;
      enqueue(event);
    },
    [config, enqueue],
  );

  const handleBootstrap = useCallback((bootstrap: OverlayBootstrap) => {
    setConfig(bootstrap.config);
    setIsEnabled(bootstrap.isEnabled);
  }, []);

  const handlers = useMemo(
    () => ({ onAlert: handleAlert, onBootstrap: handleBootstrap }),
    [handleAlert, handleBootstrap],
  );

  const state = useOverlayConnection(token, handlers);

  // Никаких сообщений об ошибках на экране: любой текст попадёт в эфир. Проблемы
  // видны в дашборде (оверлей не отмечался как активный) и в консоли браузера.
  if (state === 'invalid-token' || state === 'revoked') return null;
  if (!isEnabled) return null;

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
              ? `${exitAnimationName(config.animationOut)} ${ALERT_EXIT_DURATION_MS}ms ease-in both`
              : undefined,
          }}
        >
          <AlertCard event={current.event} config={config} animate={!current.isLeaving} />
        </div>
      ) : null}
    </>
  );
}
