import { zodResolver } from '@hookform/resolvers/zod';
import { configSchemaFor, hasWidgetState } from '@streamkit/contracts';
import { useEffect } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { usePageTitle } from '@/components/header';
import { Button, Card } from '@/components/ui';
import { OverlayTokens } from '@/features/widgets/OverlayTokens';
import { useUpdateWidget, useWidget, useWidgetState } from '@/features/widgets/queries';
import { WidgetConfigForm } from '@/features/widgets/WidgetConfigForm';
import { WidgetPreview } from '@/features/widgets/WidgetPreview';
import { WidgetStateControls } from '@/features/widgets/WidgetStateControls';
import { ApiError } from '@/lib/api';

/**
 * Редактор виджета.
 *
 * Обвязка (имя, предпросмотр, ссылки OBS, сохранение) общая для всех типов,
 * различается только набор полей и рендерер предпросмотра. Схема валидации
 * выбирается по типу загруженного виджета — тип менять нельзя, у цели и
 * таймера нет ни одного общего поля.
 */
export function WidgetEditorPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const widget = useWidget(id);
  const updateWidget = useUpdateWidget(id);
  const type = widget.data?.type ?? 'alerts';
  const state = useWidgetState(id, Boolean(widget.data) && hasWidgetState(type));

  const form = useForm<FieldValues>({
    resolver: zodResolver(configSchemaFor(type)),
    // Значения приходят асинхронно, поэтому форма наполняется через reset ниже.
    defaultValues: configSchemaFor(type).parse({}) as FieldValues,
  });

  useEffect(() => {
    if (widget.data) {
      form.reset(widget.data.config as FieldValues);
    }
  }, [widget.data, form]);

  // Предпросмотр обновляется на каждое изменение поля: подбирать размер шрифта
  // и цвет обводки вслепую, сохраняя и переключаясь в OBS, невозможно.
  const previewConfig = form.watch();
  usePageTitle(widget.data?.name);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateWidget.mutateAsync({ config: values });
      toast.success(t('common.save'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  });

  if (widget.isLoading || !widget.data) {
    return (
      <p role="status" className="text-muted">
        {t('common.loading')}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to="/widgets" className="py-1 text-sm text-muted hover:text-fg">
          <span aria-hidden="true">← </span>
          {t('common.back')}
        </Link>
        <h1 className="min-w-0 text-2xl font-semibold break-words">{widget.data.name}</h1>
        <span className="rounded bg-surface-hover px-2 py-0.5 text-xs text-muted">
          {t(`widgets.type.${type}`)}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <form onSubmit={onSubmit} className="space-y-5">
          <WidgetConfigForm type={type} form={form} />

          <Button type="submit" isLoading={updateWidget.isPending}>
            {t('common.save')}
          </Button>
        </form>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-medium">{t('widgets.preview')}</h2>
            <WidgetPreview
              type={type}
              config={previewConfig as Record<string, unknown>}
              state={state.data ?? null}
            />
          </Card>

          <WidgetStateControls widget={widget.data} />

          <OverlayTokens widgetId={id} />
        </div>
      </div>
    </div>
  );
}
