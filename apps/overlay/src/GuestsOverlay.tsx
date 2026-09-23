import {
  AudioTrack,
  isTrackReference,
  LiveKitRoom,
  type TrackReference,
  useParticipantAttributes,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import {
  type GuestsWidgetConfig,
  isMirrored,
  parseParticipantIdentity,
  type RoomAccess,
  roomAccessSchema,
} from '@streamkit/contracts';
import { ParticipantLayout } from '@streamkit/ui';
import { Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Потолок паузы между попытками: как у сокета оверлея, сцену никто не перезагрузит. */
const MAX_RETRY_MS = 30_000;

/**
 * Гости приватной комнаты в кадре OBS.
 *
 * Отдельный модуль грузится лениво: клиент WebRTC тяжелее всего остального
 * оверлея, а нужен только виджету гостей. Оверлей оповещений в каждой сцене
 * платить за него загрузкой не должен.
 *
 * Доступ к комнате запрашивается HTTP, а не сокетом оверлея, и заново — при
 * смене комнаты в настройках и после каждого обрыва. Токен LiveKit живёт пять
 * минут: подключённому клиенту сервер продлевает его сам, но после долгого
 * обрыва старый уже не примут.
 */
export function GuestsOverlay({
  overlayToken,
  config,
}: {
  overlayToken: string;
  config: GuestsWidgetConfig;
}): React.JSX.Element | null {
  const [access, setAccess] = useState<(RoomAccess & { roomId: string }) | null>(null);
  // Номер попытки запускает новый запрос доступа; число неудач подряд — только
  // пауза перед ним. Это разные вещи: сброс счётчика после удачного входа не
  // должен сам по себе запускать ещё один вход.
  const [generation, setGeneration] = useState(0);
  const failures = useRef(0);
  const roomId = config.roomId;

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    // Первая попытка сразу, дальше с растущей паузой: 1, 2, 4… до 30 секунд.
    const delay =
      failures.current === 0 ? 0 : Math.min(1000 * 2 ** (failures.current - 1), MAX_RETRY_MS);

    const timer = setTimeout(() => {
      void fetchAccess(overlayToken)
        .then((next) => {
          if (!cancelled) setAccess({ ...next, roomId });
        })
        .catch(() => {
          // Никакого текста на экране: он попал бы в эфир. Просто пробуем снова.
          failures.current += 1;
          if (!cancelled) setGeneration((current) => current + 1);
        });
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [overlayToken, roomId, generation]);

  const connected = useCallback(() => {
    failures.current = 0;
  }, []);

  // Обработчики стабильны: у `LiveKitRoom` они в зависимостях эффекта
  // подключения, и новая стрелка на каждый рендер повторяла бы вход.
  const reconnect = useCallback(() => {
    failures.current += 1;
    setAccess(null);
    setGeneration((current) => current + 1);
  }, []);

  // Доступ, выданный к прежней комнате, после смены комнаты в настройках не
  // используется: иначе кадр пару секунд показывал бы гостей не той комнаты.
  if (!roomId || !access || access.roomId !== roomId) return null;

  return (
    <LiveKitRoom
      key={access.token}
      serverUrl={access.url}
      token={access.token}
      connect
      audio={false}
      video={false}
      // Слой simulcast выбирается по размеру плитки: браузер-сорс 480p не должен
      // тянуть 720p каждого гостя, а сервер — отправлять его.
      options={{ adaptiveStream: true }}
      onConnected={connected}
      onDisconnected={reconnect}
      onError={reconnect}
      style={{ width: '100%', height: '100%' }}
    >
      <GuestsStage config={config} />
    </LiveKitRoom>
  );
}

function GuestsStage({ config }: { config: GuestsWidgetConfig }): React.JSX.Element {
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const microphones = useTracks([Track.Source.Microphone]);

  // Только гости. Стример в кадре уже есть — через свою камеру в OBS, — а его
  // звук из комнаты удвоил бы голос в эфире с задержкой. Это ловится только на
  // слух в записи, поэтому отсекается здесь, по роли, а не настройкой.
  const isGuest = (identity: string): boolean =>
    parseParticipantIdentity(identity)?.role === 'guest';

  const tiles = cameras
    .filter((ref) => isGuest(ref.participant.identity))
    .map((ref) => {
      const hasVideo = isTrackReference(ref) && !ref.publication.isMuted;
      return {
        id: ref.participant.identity,
        name: ref.participant.name || '',
        hasVideo,
        media: hasVideo && isTrackReference(ref) ? <GuestVideo trackRef={ref} /> : null,
      };
    });

  return (
    <>
      <ParticipantLayout config={config} tiles={tiles} />
      {microphones
        .filter((ref) => isGuest(ref.participant.identity))
        .map((ref) => (
          <AudioTrack key={ref.publication.trackSid} trackRef={ref} />
        ))}
    </>
  );
}

/**
 * Видео гостя в кадре — зеркальное, если гость сам так решил.
 *
 * Выбор приходит атрибутом участника: настройки виджета его не содержат и
 * содержать не должны — стример не разворачивает чужую камеру.
 */
function GuestVideo({ trackRef }: { trackRef: TrackReference }): React.JSX.Element {
  const { attributes } = useParticipantAttributes({ participant: trackRef.participant });
  return (
    <VideoTrack
      trackRef={trackRef}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'block',
        transform: isMirrored(attributes) ? 'scaleX(-1)' : undefined,
      }}
    />
  );
}

async function fetchAccess(overlayToken: string): Promise<RoomAccess> {
  const response = await fetch(`${API_URL}/api/overlay/room-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: overlayToken }),
  });
  if (!response.ok) throw new Error(`room-access ${response.status}`);
  return roomAccessSchema.parse(await response.json());
}
