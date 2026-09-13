import {
  isTrackReference,
  RoomAudioRenderer,
  useLocalParticipant,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { parseParticipantIdentity } from '@streamkit/contracts';
import { type Participant, Track } from 'livekit-client';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';

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
}: {
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
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  const others = cameras.filter((ref) => !ref.participant.isLocal);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cameras.map((ref) => {
          const participant = ref.participant;
          const role = parseParticipantIdentity(participant.identity)?.role;
          const hasVideo = isTrackReference(ref) && !ref.publication.isMuted;

          return (
            <div
              key={participant.identity}
              data-testid="room-tile"
              className="overflow-hidden rounded-lg border border-border bg-bg"
            >
              <div className="relative aspect-video bg-black">
                {hasVideo ? (
                  <VideoTrack
                    trackRef={ref}
                    className="h-full w-full object-cover"
                    // Своё изображение зеркалим, как в любом созвоне: иначе
                    // движение руки вправо на экране уходит влево, и это сбивает.
                    style={participant.isLocal ? { transform: 'scaleX(-1)' } : undefined}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-lg text-muted">
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
            </div>
          );
        })}
      </div>

      {others.length === 0 ? <p className="text-sm text-muted">{t('rooms.stage.empty')}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={isMicrophoneEnabled ? 'secondary' : 'ghost'}
          aria-pressed={isMicrophoneEnabled}
          onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        >
          {t('rooms.stage.mic')}: {isMicrophoneEnabled ? t('rooms.stage.on') : t('rooms.stage.off')}
        </Button>
        <Button
          variant={isCameraEnabled ? 'secondary' : 'ghost'}
          aria-pressed={isCameraEnabled}
          onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
        >
          {t('rooms.stage.camera')}: {isCameraEnabled ? t('rooms.stage.on') : t('rooms.stage.off')}
        </Button>
        <Button variant="ghost" onClick={onLeave}>
          {t('rooms.stage.leave')}
        </Button>
      </div>

      {/* Звук остальных участников. Только подписанные дорожки, то есть чужие:
          собственный микрофон на себя не заворачивается, иначе свой голос был бы
          слышен с задержкой. */}
      <RoomAudioRenderer />
    </div>
  );
}
