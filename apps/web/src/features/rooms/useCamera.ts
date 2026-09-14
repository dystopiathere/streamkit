import { useConnectionState, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState, type LocalVideoTrack, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Сколько камера остаётся открытой после выключения.
 *
 * Выключить и тут же включить обратно — обычное дело посреди эфира: поправить
 * свет, отойти на минуту. Стандартное выключение в livekit-client закрывает
 * устройство, и включение открывало его заново — у настоящей вебкамеры это
 * секунды чёрного кадра. На фальшивой камере в тестах те же 100 мс, поэтому
 * задержку видно только на живом устройстве.
 *
 * Пока идёт пауза, видео никуда не уходит: дорожка заглушена, и участники видят
 * плитку с именем. Но индикатор камеры горит, и держать его дольше необходимого
 * нельзя: человек выключил камеру и видит, что она «всё ещё включена». Полминуты
 * покрывают «поправить свет» и не выглядят как камера, которая не выключилась.
 */
export const CAMERA_RELEASE_MS = 30_000;

const CAPTURE: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

/**
 * Камера, которая включается мгновенно после недавнего выключения.
 *
 * Дорожку публикуем сами, как «пользовательскую» (`MediaStreamTrack`, а не
 * `setCameraEnabled`). Для такой дорожки livekit-client при заглушении не
 * останавливает устройство — только выключает передачу, — а когда устройство
 * закрыли по таймеру, при включении мы подкладываем в ту же публикацию свежий
 * захват через `replaceTrack`, без повторной публикации.
 */
export function useCamera({ onJoin, deviceId }: { onJoin: boolean; deviceId?: string }) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const connection = useConnectionState();
  const [pending, setPending] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);

  const [failed, setFailed] = useState(false);

  const capture = useCallback(async (): Promise<MediaStreamTrack> => {
    // «default» — не идентификатор устройства, а псевдоним, который отдаёт выбор
    // устройств. С `exact` он даёт OverconstrainedError, и камера молча не
    // включалась при входе: livekit-client раньше вычищал его сам, а собственный
    // захват — нет.
    const exact = deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {};
    const stream = await navigator.mediaDevices.getUserMedia({ video: { ...CAPTURE, ...exact } });
    return stream.getVideoTracks()[0]!;
  }, [deviceId]);

  const cancelRelease = (): void => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
  };

  const enable = useCallback(async () => {
    cancelRelease();
    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    const track = publication?.videoTrack as LocalVideoTrack | undefined;

    if (!publication || !track) {
      await localParticipant.publishTrack(await capture(), {
        source: Track.Source.Camera,
        simulcast: true,
      });
      return;
    }
    if (track.mediaStreamTrack.readyState === 'ended') {
      await track.replaceTrack(await capture(), true);
    }
    await publication.unmute();
  }, [capture, localParticipant]);

  const disable = useCallback(async () => {
    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    if (!publication) return;
    await publication.mute();

    cancelRelease();
    releaseTimer.current = setTimeout(() => {
      releaseTimer.current = null;
      // `stop()` не порождает событие `ended`, и публикация остаётся на месте:
      // гаснет только индикатор камеры. Следующее включение подложит новый захват.
      publication.videoTrack?.mediaStreamTrack.stop();
    }, CAMERA_RELEASE_MS);
  }, [localParticipant]);

  const toggle = useCallback(async () => {
    setPending(true);
    try {
      await (isCameraEnabled ? disable() : enable());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }, [disable, enable, isCameraEnabled]);

  // Камера при входе включается один раз, после подключения к комнате.
  useEffect(() => {
    if (!onJoin || started.current || connection !== ConnectionState.Connected) return;
    started.current = true;
    // Отказ не глотается молча: гость без камеры должен видеть, что это не
    // «так и задумано», а нет доступа к устройству.
    enable().then(
      () => setFailed(false),
      () => setFailed(true),
    );
  }, [connection, enable, onJoin]);

  // Уход со страницы закрывает устройство сразу, не дожидаясь таймера: иначе
  // индикатор камеры горел бы ещё полминуты после выхода из комнаты.
  useEffect(
    () => () => {
      cancelRelease();
      localParticipant
        .getTrackPublication(Track.Source.Camera)
        ?.videoTrack?.mediaStreamTrack.stop();
    },
    [localParticipant],
  );

  return { enabled: isCameraEnabled, pending, failed, toggle };
}
