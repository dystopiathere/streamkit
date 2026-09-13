import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button, Card, Input } from '@/components/ui';
import { useCreateInvite, useInvites, useRevokeInvite } from './queries';

/**
 * Ссылки-приглашения комнаты.
 *
 * Устроено как ссылки OBS: ссылка приходит один раз при создании, в БД только
 * хэш, поэтому свежая ссылка висит отдельным блоком, пока её не закроют. Подпись
 * обязательна — иначе в списке не понять, чью ссылку отзывать.
 */
export function RoomInvites({ roomId }: { roomId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const invites = useInvites(roomId);
  const createInvite = useCreateInvite(roomId);
  const revokeInvite = useRevokeInvite(roomId);
  const [label, setLabel] = useState('');
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    const created = await createInvite.mutateAsync(trimmed);
    setFreshUrl(created.url);
    setLabel('');
  };

  const handleCopy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('common.copied'));
    } catch {
      // Clipboard API недоступен без https — ссылку выделяют руками, поле остаётся.
      toast.error(t('common.error'));
    }
  };

  const handleRevoke = async (inviteId: string): Promise<void> => {
    if (!window.confirm(t('rooms.invites.revokeConfirm'))) return;
    await revokeInvite.mutateAsync(inviteId);
    setFreshUrl(null);
  };

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">{t('rooms.invites.title')}</h2>

      <div className="flex flex-wrap gap-2">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t('rooms.invites.labelPlaceholder')}
          maxLength={80}
          className="max-w-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleCreate();
          }}
        />
        <Button
          variant="secondary"
          onClick={handleCreate}
          isLoading={createInvite.isPending}
          disabled={label.trim().length === 0}
        >
          {t('rooms.invites.create')}
        </Button>
      </div>

      {freshUrl ? (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/10 p-3">
          <p className="text-xs text-muted">{t('rooms.invites.oneTimeWarning')}</p>
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label={t('rooms.invites.title')}
              value={freshUrl}
              onFocus={(event) => event.target.select()}
            />
            <Button variant="secondary" onClick={() => void handleCopy(freshUrl)}>
              {t('common.copy')}
            </Button>
          </div>
        </div>
      ) : null}

      {invites.data?.length === 0 ? (
        <p className="text-sm text-muted">{t('rooms.invites.empty')}</p>
      ) : null}

      <ul className="space-y-2">
        {invites.data?.map((invite) => (
          <li
            key={invite.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate">{invite.label}</p>
              <p className="text-xs text-muted">
                {t('rooms.invites.lastUsed')}:{' '}
                {invite.lastUsedAt
                  ? new Date(invite.lastUsedAt).toLocaleString('ru-RU')
                  : t('rooms.invites.never')}
              </p>
            </div>
            <Button variant="ghost" onClick={() => void handleRevoke(invite.id)}>
              {t('rooms.invites.revoke')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
