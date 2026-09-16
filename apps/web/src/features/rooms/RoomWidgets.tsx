import type { CreateWidgetInput } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, ButtonLink, Card } from '@/components/ui';
import { useCreateWidget, useWidgets } from '@/features/widgets/queries';

/**
 * Виджеты гостей, привязанные к этой комнате, и создание нового — сразу с ней.
 *
 * Раньше путь был только один: создать виджет в разделе «Виджеты», открыть
 * редактор и выбрать комнату в списке. Пропустить этот выбор было легко, и
 * виджет без комнаты выглядел как поломка: оверлей подключался, а гостей не
 * было. Отсюда виджет рождается уже привязанным.
 */
export function RoomWidgets({ roomId, roomName }: { roomId: string; roomName: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const widgets = useWidgets();
  const createWidget = useCreateWidget();

  const bound = (widgets.data ?? []).filter(
    (widget) => widget.type === 'guests' && widget.config.roomId === roomId,
  );

  const handleCreate = async (): Promise<void> => {
    const created = await createWidget.mutateAsync({
      name: roomName,
      type: 'guests',
      config: { roomId },
    } as CreateWidgetInput);
    void navigate(`/widgets/${created.id}`);
  };

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">{t('rooms.obs.title')}</h2>
      <p className="max-w-2xl text-sm text-muted">{t('rooms.obs.hint')}</p>

      {widgets.data && bound.length === 0 ? (
        <p className="text-sm text-muted">{t('rooms.obs.empty')}</p>
      ) : null}

      <ul className="space-y-2">
        {bound.map((widget) => (
          <li
            key={widget.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-2 text-sm"
          >
            <span className="min-w-0 truncate">{widget.name}</span>
            <ButtonLink
              to={`/widgets/${widget.id}`}
              variant="ghost"
              aria-label={t('common.openNamed', { name: widget.name })}
            >
              {t('rooms.obs.open')}
            </ButtonLink>
          </li>
        ))}
      </ul>

      <Button variant="secondary" onClick={handleCreate} isLoading={createWidget.isPending}>
        {t('rooms.obs.create')}
      </Button>
    </Card>
  );
}
