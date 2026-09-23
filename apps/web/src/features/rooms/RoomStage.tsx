import {
  isTrackReference,
  RoomAudioRenderer,
  type TrackReference,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipantAttributes,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { isMirrored, mirrorAttribute, parseParticipantIdentity } from '@streamkit/contracts';
import { type Participant, Track } from 'livekit-client';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@streamkit/app-kit';
import { MicrophoneSettings } from './MicrophoneSettings';
import { useMirrorCamera, writeMirrorCamera } from './mirror';
import { useCamera } from './useCamera';
import { useMicrophone } from './useMicrophone';

/**
 * Участники комнаты плитками и свои кнопки микрофона и камеры.
 *
 * Общая для стримера и гостя: отличаются только действия под плиткой (удалить,
 * заглушить есть лишь у стримера). Живёт внутри `<LiveKitRoom>` и берёт всё из
 * его контекста.
 *
 * Это не рендерер эфира: в OBS гости выводятся `ParticipantLayout` из
 * `@streamkit/ui` с оформлением из настроек виджета. Здесь — рабочий экран
 * созвона, и оформлять его настройками виджета было бы странно.
 */
export function RoomStage({
  actions,
  onLeave,
  cameraOnJoin,
  cameraDeviceId,
  microphoneDeviceId,
}: {
  /** Включить камеру сразу после входа. */
  cameraOnJoin: boolean;
  cameraDeviceId?: string;
  microphoneDeviceId?: string;
  /** Кнопки под плиткой участника, например «Удалить» у стримера. */
  actions?: (participant: Participant) => ReactNode;
  onLeave: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  // С заглушками: участник без камеры тоже получает плитку, иначе гость,
  // выключивший камеру, пропадал бы из списка вместе с кнопкой «Удалить».
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const camera = useCamera({ onJoin: cameraOnJoin, deviceId: cameraDeviceId });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mirror = useMirrorCamera();
  const { localParticipant } = useLocalParticipant();

  // Свой выбор зеркала — атрибутом участника: его видят и остальные, и кадр
  // OBS. Ставится и при входе, а не только на переключение: гость с прошлым
  // выбором иначе выглядел бы для всех незеркальным.
  useEffect(() => {
    void localParticipant.setAttributes(mirrorAttribute(mirror)).catch(() => {
      // Права на свои атрибуты нет (старый токен) — зеркало останется личным.
    });
  }, [localParticipant, mirror]);

  // Право на микрофон приходит с сервера и меняется на лету, когда стример
  // выключает гостю микрофон. Кнопку при этом не просто красим: без права
  // публикация всё равно не пройдёт, и гость должен понимать почему.
  const permissions = useLocalParticipantPermissions();
  const microphoneAllowed =
    !permissions?.canPublishSources.length ||
    permissions.canPublishSources.map(Track.sourceFromProto).includes(Track.Source.Microphone);

  // Микрофон публикуется при входе всегда, когда есть право: и у стримера, и у
  // гостя. Без права — нет: сервер откажет, и гость увидел бы ошибку вместо
  // объяснения на кнопке.
  const microphone = useMicrophone({
    onJoin: true,
    allowed: microphoneAllowed,
    deviceId: microphoneDeviceId,
  });

  const others = cameras.filter((ref) => !ref.participant.isLocal);

  return (
    <div className="space-y-4">
      <ul
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-label={t('rooms.stage.participants')}
      >
        {cameras.map((ref) => {
          const participant = ref.participant;
          const role = parseParticipantIdentity(participant.identity)?.role;
          const hasVideo = isTrackReference(ref) && !ref.publication.isMuted;

          return (
            <li
              key={participant.identity}
              data-testid="room-tile"
              className="overflow-hidden rounded-lg border border-border bg-bg"
            >
              <div className="relative aspect-video bg-black">
                {hasVideo && isTrackReference(ref) ? (
                  <CameraVideo trackRef={ref} />
                ) : (
                  <div
                    aria-hidden="true"
                    className="grid h-full place-items-center text-lg text-muted"
                  >
                    {participant.name || participant.identity}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                <span className="min-w-0 truncate">
                  {participant.name || participant.identity}
                  {participant.isLocal ? (
                    <span className="text-muted"> · {t('rooms.stage.you')}</span>
                  ) : role === 'host' ? (
                    <span className="text-muted"> · {t('rooms.stage.host')}</span>
                  ) : null}
                </span>
                {!participant.isLocal && role === 'guest' ? actions?.(participant) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {others.length === 0 ? (
        <p role="status" className="text-sm text-muted">
          {t('rooms.stage.empty')}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {microphoneAllowed ? (
          <Button
            // Состояние — в тексте кнопки («Микрофон: вкл»). aria-pressed
            // поверх него заставлял скринридер произносить его дважды.
            variant={microphone.enabled ? 'secondary' : 'ghost'}
            onClick={microphone.toggle}
          >
            {t('rooms.stage.mic')}:{' '}
            {microphone.enabled ? t('rooms.stage.on') : t('rooms.stage.off')}
          </Button>
        ) : (
          <Button variant="ghost" disabled>
            {t('rooms.stage.micBlocked')}
          </Button>
        )}
        <Button
          variant={camera.enabled ? 'secondary' : 'ghost'}
          disabled={camera.pending}
          onClick={() => void camera.toggle()}
        >
          {t('rooms.stage.camera')}: {camera.enabled ? t('rooms.stage.on') : t('rooms.stage.off')}
        </Button>
        {/* Зеркало — про свою камеру и только про неё: развернуть чужую нельзя
            ни стримеру, ни гостю. */}
        <Button variant={mirror ? 'secondary' : 'ghost'} onClick={() => writeMirrorCamera(!mirror)}>
          {t('rooms.stage.mirror')}: {mirror ? t('rooms.stage.on') : t('rooms.stage.off')}
        </Button>
        <Button
          variant="ghost"
          aria-expanded={settingsOpen}
          aria-controls="microphone-settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          {t('rooms.microphone.title')}
        </Button>
        <Button variant="ghost" onClick={onLeave}>
          {t('rooms.stage.leave')}
        </Button>
      </div>

      {settingsOpen ? (
        <div id="microphone-settings" className="rounded-lg border border-border p-3">
          <MicrophoneSettings />
        </div>
      ) : null}

      <p className="text-xs text-muted">{t('rooms.stage.mirrorHint')}</p>

      {microphone.failed ? (
        <p role="alert" className="text-sm text-danger">
          {t('rooms.stage.microphoneFailed')}
        </p>
      ) : null}
      {camera.failed ? (
        <p role="alert" className="text-sm text-danger">
          {t('rooms.stage.cameraFailed')}
        </p>
      ) : null}

      {/* Звук остальных участников. Только подписанные дорожки, то есть чужие:
          собственный микрофон на себя не заворачивается, иначе свой голос был бы
          слышен с задержкой. */}
      <RoomAudioRenderer />
    </div>
  );
}

/**
 * Видео участника — зеркальное, если он сам так решил.
 *
 * Отдельный компонент, потому что атрибуты читаются по участнику: хук нельзя
 * позвать внутри `map`. Зеркало берётся из атрибута и у себя тоже — чтобы своя
 * плитка показывала ровно то, что видят остальные и кадр OBS.
 */
function CameraVideo({ trackRef }: { trackRef: TrackReference }): React.JSX.Element {
  const { attributes } = useParticipantAttributes({ participant: trackRef.participant });
  return (
    <VideoTrack
      trackRef={trackRef}
      className="h-full w-full object-cover"
      style={isMirrored(attributes) ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}
