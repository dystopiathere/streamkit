import { defaultAlertWidgetConfig } from '@streamkit/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, Input } from '@/components/ui';
import {
  useCreateWidget,
  useDeleteWidget,
  useSendTestAlert,
  useWidgets,
} from '@/features/widgets/queries';

export function WidgetsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');

  const widgets = useWidgets();
  const createWidget = useCreateWidget();
  const deleteWidget = useDeleteWidget();
  const testAlert = useSendTestAlert();

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    await createWidget.mutateAsync({
      name: trimmed,
      type: 'alerts',
      config: defaultAlertWidgetConfig(),
    });
    setName('');
  };

  const handleDelete = async (id: string): Promise<void> => {
    // Удаление виджета рвёт все его ссылки, включая уже настроенные в OBS,
    // поэтому спрашиваем подтверждение.
    if (!window.confirm(t('widgets.deleteConfirm'))) return;
    await deleteWidget.mutateAsync(id);
  };

  const handleTest = async (): Promise<void> => {
    await testAlert.mutateAsync();
    toast.success(t('widgets.testSent'));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('widgets.title')}</h1>
        <Button variant="secondary" onClick={handleTest} isLoading={testAlert.isPending}>
          {t('widgets.testAlert')}
        </Button>
      </div>

      <Card>
        <div className="flex flex-wrap gap-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('widgets.namePlaceholder')}
            className="max-w-xs"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
          />
          <Button
            onClick={handleCreate}
            isLoading={createWidget.isPending}
            disabled={name.trim().length === 0}
          >
            {t('widgets.create')}
          </Button>
        </div>
      </Card>

      {widgets.isLoading ? <p className="text-muted">{t('common.loading')}</p> : null}

      {widgets.data?.length === 0 ? (
        <Card>
          <p className="text-muted">{t('widgets.empty')}</p>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {widgets.data?.map((widget) => (
          <Card key={widget.id} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate font-medium">{widget.name}</p>
              <p className="text-xs text-muted">
                {widget.isEnabled ? t('widgets.enabled') : t('widgets.disabled')}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link to={`/widgets/${widget.id}`}>
                <Button variant="secondary">{t('widgets.edit')}</Button>
              </Link>
              <Button variant="ghost" onClick={() => void handleDelete(widget.id)}>
                {t('common.delete')}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
