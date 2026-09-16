import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/components/header';
import { Button, ButtonLink, Card, Input } from '@/components/ui';
import { RoomsPaywall, useRoomsAccess } from '@/features/billing/RoomsPaywall';
import { useCreateRoom, useDeleteRoom, useRooms } from '@/features/rooms/queries';

export function RoomsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const rooms = useRooms();
  const createRoom = useCreateRoom();
  const deleteRoom = useDeleteRoom();
  const roomsAccess = useRoomsAccess();
  usePageTitle(t('rooms.title'));

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    await createRoom.mutateAsync(trimmed);
    setName('');
  };

  const handleDelete = async (id: string): Promise<void> => {
    // Удаление отключает всех, кто в комнате прямо сейчас, — возможно, посреди эфира.
    if (!window.confirm(t('rooms.deleteConfirm'))) return;
    await deleteRoom.mutateAsync(id);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('rooms.title')}</h1>
        <p className="max-w-2xl text-sm text-muted">{t('rooms.description')}</p>
      </div>

      <RoomsPaywall />

      <Card>
        <div className="flex flex-wrap gap-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('rooms.namePlaceholder')}
            aria-label={t('rooms.namePlaceholder')}
            maxLength={80}
            className="max-w-xs"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
          />
          <Button
            onClick={handleCreate}
            isLoading={createRoom.isPending}
            disabled={!roomsAccess || name.trim().length === 0}
          >
            {t('rooms.create')}
          </Button>
        </div>
      </Card>

      {rooms.isLoading ? (
        <p role="status" className="text-muted">
          {t('common.loading')}
        </p>
      ) : null}

      {rooms.data?.length === 0 ? (
        <Card>
          <p className="text-muted">{t('rooms.empty')}</p>
        </Card>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {rooms.data?.map((room) => (
          <li key={room.id}>
            <Card className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="min-w-0 truncate font-medium">{room.name}</h2>
              <div className="flex shrink-0 gap-2">
                <ButtonLink
                  to={`/rooms/${room.id}`}
                  variant="secondary"
                  aria-label={t('common.openNamed', { name: room.name })}
                >
                  {t('rooms.open')}
                </ButtonLink>
                <Button
                  variant="ghost"
                  aria-label={t('common.deleteNamed', { name: room.name })}
                  onClick={() => void handleDelete(room.id)}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
