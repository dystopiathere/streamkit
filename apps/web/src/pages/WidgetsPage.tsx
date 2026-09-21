import { WIDGET_TYPES, type CreateWidgetInput, type WidgetType } from '@streamkit/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button, ButtonLink, Card, Input, selectClasses, usePageTitle } from '@streamkit/app-kit';
import { Link } from 'react-router-dom';
import { usePlanFeatures } from '@/features/billing/PlanPaywall';
import {
  useCreateWidget,
  useDeleteWidget,
  useSendTestAlert,
  useWidgets,
} from '@/features/widgets/queries';
import { ApiError } from '@/lib/api';

export function WidgetsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [type, setType] = useState<WidgetType>('alerts');

  const widgets = useWidgets();
  const limit = usePlanFeatures()?.widgets ?? null;
  const used = widgets.data?.length ?? 0;
  // Пока подписка или список не загрузились, кнопка остаётся активной: отказ по
  // лимиту всё равно придёт с сервера, а мигающая выключенная кнопка у того,
  // кто заплатил, — хуже.
  const limitReached = limit !== null && used >= limit;
  const createWidget = useCreateWidget();
  const deleteWidget = useDeleteWidget();
  const testAlert = useSendTestAlert();
  usePageTitle(t('widgets.title'));

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    // Конфиг уходит ПУСТЫМ, а не собранным на клиенте: дефолты досыпает схема
    // на сервере. Раньше сюда уезжал defaultWidgetConfig(type), вычисленный в
    // браузере, — вместе с ним уезжала и дата начала цели по часам машины
    // стримера. Сбитые часы означали цель, которая молча никогда не наполнится.
    // Исключение — заголовки, которые видны в кадре: по умолчанию они русские,
    // и английский стример получил бы «Цель» на экране трансляции.
    const config =
      type === 'goal'
        ? { title: t('widgets.defaultTitle.goal') }
        : type === 'top-donors'
          ? { title: t('widgets.defaultTitle.topDonors') }
          : {};
    try {
      await createWidget.mutateAsync({ name: trimmed, type, config } as CreateWidgetInput);
      setName('');
    } catch (error) {
      // Отказ сервера объясняет, что сделать: виджет чата, например, просит
      // сначала подключить Twitch. Проглоченная ошибка выглядела как кнопка,
      // которая ничего не делает.
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    // Удаление виджета рвёт все его ссылки, включая уже настроенные в OBS,
    // поэтому спрашиваем подтверждение.
    if (!window.confirm(t('widgets.deleteConfirm'))) return;
    await deleteWidget.mutateAsync(id);
  };

  const handleTest = async (): Promise<void> => {
    try {
      await testAlert.mutateAsync();
      toast.success(t('widgets.testSent'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
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
            aria-label={t('widgets.namePlaceholder')}
            className="max-w-xs"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
          />
          {/* Тип выбирается ОДИН раз, при создании: у цели и таймера нет ни
              одного общего поля конфига, и «сменить тип» означало бы стереть
              все настройки. Отдельный виджет честнее. */}
          <select
            aria-label={t('widgets.field.type')}
            className={`${selectClasses} w-auto`}
            value={type}
            onChange={(event) => setType(event.target.value as WidgetType)}
          >
            {WIDGET_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`widgets.type.${value}`)}
              </option>
            ))}
          </select>
          <Button
            onClick={handleCreate}
            isLoading={createWidget.isPending}
            disabled={name.trim().length === 0 || limitReached}
          >
            {t('widgets.create')}
          </Button>
        </div>
        {limit !== null ? (
          <p className="mt-3 text-xs text-muted">
            {t('widgets.limit', { used, limit })}
            {limitReached ? (
              <>
                {' '}
                <Link to="/billing" className="underline hover:text-fg">
                  {t('widgets.limitAction')}
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </Card>

      {widgets.isLoading ? (
        <p role="status" className="text-muted">
          {t('common.loading')}
        </p>
      ) : null}

      {widgets.data?.length === 0 ? (
        <Card>
          <p className="text-muted">{t('widgets.empty')}</p>
        </Card>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {widgets.data?.map((widget) => (
          <li key={widget.id}>
            <Card className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate font-medium">{widget.name}</h2>
                <p className="text-xs text-muted">
                  {t(`widgets.type.${widget.type}`)} ·{' '}
                  {widget.isEnabled ? t('widgets.enabled') : t('widgets.disabled')}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <ButtonLink
                  to={`/widgets/${widget.id}`}
                  variant="secondary"
                  aria-label={t('common.editNamed', { name: widget.name })}
                >
                  {t('widgets.edit')}
                </ButtonLink>
                <Button
                  variant="ghost"
                  aria-label={t('common.deleteNamed', { name: widget.name })}
                  onClick={() => void handleDelete(widget.id)}
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
