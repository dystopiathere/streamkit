import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Card, Input } from '@/components/ui';
import { RoomsPaywall, useRoomsAccess } from '@/features/billing/RoomsPaywall';
import { useCreateRoom, useDeleteRoom, useRooms } from '@/features/rooms/queries';

export function RoomsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const rooms = useRooms();
  const createRoom = useCreateRoom();
  const deleteRoom = useDeleteRoom();
  const roomsAccess = useRoomsAccess();

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

      {rooms.isLoading ? <p className="text-muted">{t('common.loading')}</p> : null}

      {rooms.data?.length === 0 ? (
        <Card>
          <p className="text-muted">{t('rooms.empty')}</p>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {rooms.data?.map((room) => (
          <Card key={room.id} className="flex items-center justify-between gap-4">
            <p className="min-w-0 truncate font-medium">{room.name}</p>
            <div className="flex shrink-0 gap-2">
              <Link to={`/rooms/${room.id}`}>
                <Button variant="secondary">{t('rooms.open')}</Button>
              </Link>
              <Button variant="ghost" onClick={() => void handleDelete(room.id)}>
                {t('common.delete')}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
