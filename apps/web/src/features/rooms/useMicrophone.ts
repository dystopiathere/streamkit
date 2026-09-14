import { useConnectionState, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState, type LocalAudioTrack, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type MicrophoneProcessing,
  microphoneCaptureOptions,
  microphonePublishOptions,
  useMicrophoneProcessing,
} from './microphone-processing';

const sameCapture = (a: MicrophoneProcessing, b: MicrophoneProcessing): boolean =>
  a.noiseSuppression === b.noiseSuppression &&
  a.echoCancellation === b.echoCancellation &&
  a.autoGainControl === b.autoGainControl;

/**
 * Микрофон с выбранной степенью обработки голоса.
 *
 * Публикуем сами, а не через `audio` у `LiveKitRoom`: тот передаёт только
 * параметры захвата, а битрейт и DTX задаются при публикации. К тому же кнопка
 * микрофона после запрета стримером публикует дорожку заново, и без явных
 * параметров она молча возвращала бы обработку по умолчанию.
 *
 * Смена настроек в комнате применяется сразу:
 * - шумо- и эхоподавление, автоусиление — перезахват устройства в той же
 *   публикации (`restartTrack`): собеседники слышат щелчок, а не пропадание;
 * - качество передачи — только новой публикацией, DTX согласуется в SDP.
 *   Выключенный микрофон при этом снимается с публикации и НЕ публикуется
 *   заново до нажатия кнопки: иначе смена настройки на миг открыла бы звук,
 *   который человек выключил.
 *
 * Все действия идут одной очередью: переключение пресетов подряд иначе
 * запускало бы параллельные перезахваты одного устройства.
 */
export function useMicrophone({
  onJoin,
  allowed,
  deviceId,
}: {
  /** Публиковать микрофон сразу после входа. */
  onJoin: boolean;
  /** Есть ли у участника право на микрофон — его отнимает стример. */
  allowed: boolean;
  deviceId?: string;
}) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const connection = useConnectionState();
  const processing = useMicrophoneProcessing();
  const [failed, setFailed] = useState(false);

  // Задачи в очереди исполняются позже рендера, в котором их поставили, и
  // должны видеть последние настройки, а не те, что были при постановке.
  const latest = useRef({ processing, deviceId });
  useEffect(() => {
    latest.current = { processing, deviceId };
  }, [processing, deviceId]);

  /** С какими настройками опубликована текущая дорожка; `null` — её нет. */
  const applied = useRef<MicrophoneProcessing | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const started = useRef(false);

  const run = useCallback((task: () => Promise<void>): void => {
    queue.current = queue.current.then(task).then(
      () => setFailed(false),
      () => setFailed(true),
    );
  }, []);

  const publish = useCallback(async () => {
    const { processing: current, deviceId: device } = latest.current;
    const existing = localParticipant.getTrackPublication(Track.Source.Microphone);
    await localParticipant.setMicrophoneEnabled(
      true,
      microphoneCaptureOptions(current, device),
      microphonePublishOptions(current),
    );
    // Существующую публикацию `setMicrophoneEnabled` только включает, её
    // настройки остаются прежними — их догоняет `sync`.
    if (!existing?.track) applied.current = current;
  }, [localParticipant]);

  const sync = useCallback(async () => {
    const { processing: current, deviceId: device } = latest.current;
    const publication = localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = publication?.audioTrack as LocalAudioTrack | undefined;
    if (!publication || !track) {
      // Публикации нет (микрофон не включали или его снял запрет стримера) —
      // следующее включение возьмёт свежие настройки само.
      applied.current = null;
      return;
    }
    const was = applied.current;
    if (was && sameCapture(was, current) && was.highQuality === current.highQuality) return;

    if (!was || was.highQuality !== current.highQuality) {
      const live = !publication.isMuted;
      await localParticipant.unpublishTrack(track);
      applied.current = null;
      if (live) await publish();
      return;
    }

    await track.restartTrack(microphoneCaptureOptions(current, device));
    applied.current = current;
  }, [localParticipant, publish]);

  useEffect(() => {
    if (!onJoin || !allowed || started.current || connection !== ConnectionState.Connected) {
      return;
    }
    started.current = true;
    run(publish);
  }, [allowed, connection, onJoin, publish, run]);

  useEffect(() => {
    if (connection !== ConnectionState.Connected) return;
    run(sync);
  }, [connection, processing, run, sync]);

  const toggle = useCallback(() => {
    run(async () => {
      if (localParticipant.isMicrophoneEnabled) {
        await localParticipant.setMicrophoneEnabled(false);
      } else {
        await publish();
      }
    });
  }, [localParticipant, publish, run]);

  return { enabled: isMicrophoneEnabled, failed, toggle };
}
