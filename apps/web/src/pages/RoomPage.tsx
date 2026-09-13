import { LiveKitRoom } from '@livekit/components-react';
import type { RoomAccess } from '@streamkit/contracts';
import type { Participant } from 'livekit-client';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card } from '@/components/ui';
import { RoomInvites } from '@/features/rooms/RoomInvites';
import { RoomStage } from '@/features/rooms/RoomStage';
import { useHostAccess, useMuteGuest, useRemoveGuest, useRoom } from '@/features/rooms/queries';
import { ApiError } from '@/lib/api';

/**
 * Комната глазами стримера: созвон с гостями и управление приглашениями.
 *
 * Вход — отдельной кнопкой, а не автоматически при открытии страницы. Открыть
 * страницу, чтобы выпустить ссылку, и молча включить микрофон в комнату с
 * гостями — это ровно та неожиданность, которой не должно быть посреди эфира.
 */
export function RoomPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const room = useRoom(id);
  const hostAccess = useHostAccess(id);
  const removeGuest = useRemoveGuest(id);
  const muteGuest = useMuteGuest(id);
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const [withCamera, setWithCamera] = useState(false);

  // Обработчики стабильны не ради порядка: у `LiveKitRoom` они в зависимостях
  // эффекта подключения, и новая стрелка на каждый рендер повторяла бы вход.
  const handleDisconnected = useCallback(() => setAccess(null), []);
  const handleRoomError = useCallback(() => toast.error(t('common.error')), [t]);

  const handleJoin = async (): Promise<void> => {
    try {
      setAccess(await hostAccess.mutateAsync());
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.status === 503
          ? t('rooms.notConfigured')
          : t('common.error'),
      );
    }
  };

  const handleRemove = async (participant: Participant, revoke: boolean): Promise<void> => {
    const question = revoke ? t('rooms.stage.revokeConfirm') : t('rooms.stage.removeConfirm');
    if (!window.confirm(question)) return;
    await removeGuest.mutateAsync({ identity: participant.identity, revoke });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/rooms" className="text-sm text-muted hover:text-fg">
          ← {t('common.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{room.data?.name ?? t('common.loading')}</h1>
      </div>

      <Card className="space-y-4">
        {access ? (
          <LiveKitRoom
            serverUrl={access.url}
            token={access.token}
            connect
            audio
            video={withCamera}
            onDisconnected={handleDisconnected}
            onError={handleRoomError}
          >
            <RoomStage
              onLeave={() => setAccess(null)}
              actions={(participant) => (
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => void muteGuest.mutateAsync(participant.identity)}
                  >
                    {t('rooms.stage.mute')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => void handleRemove(participant, false)}
                  >
                    {t('rooms.stage.remove')}
                  </Button>
                  <Button
                    variant="danger"
                    className="px-2 py-1 text-xs"
                    onClick={() => void handleRemove(participant, true)}
                  >
                    {t('rooms.stage.removeAndRevoke')}
                  </Button>
                </div>
              )}
            />
          </LiveKitRoom>
        ) : (
          <div className="space-y-3">
            <h2 className="font-medium">{t('rooms.lobby.title')}</h2>
            <p className="max-w-2xl text-sm text-muted">{t('rooms.lobby.hint')}</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={withCamera}
                onChange={(event) => setWithCamera(event.target.checked)}
              />
              {t('rooms.lobby.withCamera')}
            </label>
            <Button onClick={handleJoin} isLoading={hostAccess.isPending}>
              {t('rooms.lobby.join')}
            </Button>
          </div>
        )}
      </Card>

      <RoomInvites roomId={id} />
    </div>
  );
}
