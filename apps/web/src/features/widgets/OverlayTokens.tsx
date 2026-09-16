import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button, Card, Input } from '@/components/ui';
import { useCreateOverlayToken, useOverlayTokens, useRevokeOverlayToken } from './queries';

/**
 * Управление публичными ссылками виджета.
 *
 * Ссылка приходит с сервера один раз при создании: в БД хранится только её хэш.
 * Поэтому она показывается в отдельном блоке с предупреждением и не исчезает,
 * пока пользователь не закроет её сам.
 */
export function OverlayTokens({ widgetId }: { widgetId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const tokens = useOverlayTokens(widgetId);
  const createToken = useCreateOverlayToken(widgetId);
  const revokeToken = useRevokeOverlayToken(widgetId);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    const created = await createToken.mutateAsync(null);
    setFreshUrl(created.url);
  };

  const handleCopy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('common.copied'));
    } catch {
      // Clipboard API недоступен без https и без разрешения — тогда ссылку
      // просто выделяют руками, поле для этого остаётся на экране.
      toast.error(t('common.error'));
    }
  };

  const handleRevoke = async (tokenId: string): Promise<void> => {
    if (!window.confirm(t('widgets.tokens.revokeConfirm'))) return;
    await revokeToken.mutateAsync(tokenId);
    setFreshUrl(null);
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t('widgets.tokens.title')}</h2>
        <Button variant="secondary" onClick={handleCreate} isLoading={createToken.isPending}>
          {t('widgets.tokens.create')}
        </Button>
      </div>

      {freshUrl ? (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/10 p-3">
          <p id="overlay-url-hint" className="text-xs text-muted">
            {t('widgets.tokens.oneTimeWarning')}
          </p>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <Input
              readOnly
              value={freshUrl}
              aria-label={t('widgets.tokens.urlLabel')}
              aria-describedby="overlay-url-hint"
              onFocus={(event) => event.target.select()}
            />
            <Button variant="secondary" onClick={() => void handleCopy(freshUrl)}>
              {t('common.copy')}
            </Button>
          </div>
        </div>
      ) : null}

      {tokens.data?.length === 0 ? (
        <p className="text-sm text-muted">{t('widgets.tokens.empty')}</p>
      ) : null}

      <ul className="space-y-2">
        {tokens.data?.map((token) => (
          <li
            key={token.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate">{token.label ?? token.id.slice(0, 8)}</p>
              <p className="text-xs text-muted">
                {t('widgets.tokens.lastSeen')}:{' '}
                {token.lastSeenAt
                  ? new Date(token.lastSeenAt).toLocaleString('ru-RU')
                  : t('widgets.tokens.never')}
              </p>
            </div>
            <Button
              variant="ghost"
              aria-label={t('widgets.tokens.revokeNamed', {
                name: token.label ?? token.id.slice(0, 8),
              })}
              onClick={() => void handleRevoke(token.id)}
            >
              {t('widgets.tokens.revoke')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
