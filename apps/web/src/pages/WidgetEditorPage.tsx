import { zodResolver } from '@hookform/resolvers/zod';
import { type AlertEventType, configSchemaFor, hasWidgetState } from '@streamkit/contracts';
import { useEffect, useState } from 'react';
import { type FieldValues, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, cn, usePageTitle } from '@streamkit/app-kit';
import { OverlayTokens } from '@/features/widgets/OverlayTokens';
import { useUpdateWidget, useWidget, useWidgetState } from '@/features/widgets/queries';
import {
  locateError,
  type SectionId,
  sectionsFor,
  WidgetConfigForm,
} from '@/features/widgets/WidgetConfigForm';
import { WidgetPreview } from '@/features/widgets/WidgetPreview';
import { TypeMark } from '@/features/widgets/TypeMark';
import { WidgetStateControls } from '@/features/widgets/WidgetStateControls';
import { ApiError } from '@/lib/api';
import { localizedResolver } from '@/lib/form-errors';

const FORM_ID = 'widget-config';

/**
 * Редактор виджета.
 *
 * Две колонки: слева разделы настроек, справа — то, на что смотрят, пока
 * правят. Правая колонка прилипает к экрану (на широком): в ней предпросмотр,
 * «Сохранить» и ссылки для OBS. Раньше она уезжала вверх вместе со страницей —
 * правка нижних полей шла вслепую, а кнопка сохранения ждала в самом низу
 * длинной формы.
 *
 * Схема валидации выбирается по типу загруженного виджета — тип менять нельзя,
 * у цели и таймера нет ни одного общего поля.
 */
export function WidgetEditorPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const widget = useWidget(id);
  const updateWidget = useUpdateWidget(id);
  const type = widget.data?.type ?? 'alerts';
  const state = useWidgetState(id, Boolean(widget.data) && hasWidgetState(type));
  // Открытый сценарий оповещений: его поля в форме и его же пример в предпросмотре.
  const [alertScenario, setAlertScenario] = useState<AlertEventType>('donation');
  const [section, setSection] = useState<SectionId>(() => sectionsFor(type)[0]!.id);

  const form = useForm<FieldValues>({
    resolver: localizedResolver(zodResolver(configSchemaFor(type))),
    // Значения приходят асинхронно, поэтому форма наполняется через reset ниже.
    defaultValues: configSchemaFor(type).parse({}) as FieldValues,
  });
  const dirty = form.formState.isDirty;

  useEffect(() => {
    if (widget.data) {
      form.reset(widget.data.config as FieldValues);
      setSection((current) =>
        sectionsFor(widget.data.type).some((item) => item.id === current)
          ? current
          : sectionsFor(widget.data.type)[0]!.id,
      );
    }
  }, [widget.data, form]);

  // Разделы прячут поля, а несохранённая правка в закрытом разделе легко
  // забывается. Закрыть вкладку с ней — только через вопрос браузера.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Предпросмотр обновляется на каждое изменение поля: подбирать размер шрифта
  // и цвет обводки вслепую, сохраняя и переключаясь в OBS, невозможно.
  const previewConfig = form.watch();
  usePageTitle(widget.data?.name);

  const onSubmit = form.handleSubmit(
    async (values) => {
      try {
        await updateWidget.mutateAsync({ config: values });
        toast.success(t('widgets.editor.saved'));
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : t('common.error'));
      }
    },
    (errors) => {
      // Ошибка может сидеть в закрытом разделе или в другом сценарии — тогда
      // «Сохранить» выглядела бы сломанной. Ведём туда, где её видно.
      const place = locateError(type, errors);
      if (place?.scenario) setAlertScenario(place.scenario);
      if (place) setSection(place.section);
      toast.error(t('widgets.editor.invalid'));
    },
  );

  if (widget.isLoading || !widget.data) {
    return (
      <p role="status" className="text-muted">
        {t('common.loading')}
      </p>
    );
  }

  const currency = state.data && 'currency' in state.data ? state.data.currency : 'RUB';

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to="/widgets" className="py-1 text-sm text-muted hover:text-fg">
          <span aria-hidden="true">← </span>
          {t('common.back')}
        </Link>
        <h1 className="min-w-0 text-2xl font-semibold break-words">{widget.data.name}</h1>
        <TypeMark type={type} className="text-sm text-muted" />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <form id={FORM_ID} onSubmit={onSubmit} noValidate className="min-w-0">
          <WidgetConfigForm
            type={type}
            form={form}
            currency={currency}
            state={state.data ?? null}
            section={section}
            onSectionChange={setSection}
            alertScenario={alertScenario}
            onAlertScenarioChange={setAlertScenario}
          />
        </form>

        {/* Прилипает целиком и прокручивается сама, если выше экрана: ссылки
            OBS внизу колонки не должны становиться недостижимыми. */}
        <aside
          aria-label={t('widgets.editor.aside')}
          className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
        >
          <SaveBar dirty={dirty} saving={updateWidget.isPending} onDiscard={() => form.reset()} />

          <Card className="p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="font-medium">{t('widgets.preview')}</h2>
              {type === 'alerts' ? (
                <span className="text-xs text-muted">{t(`events.type.${alertScenario}`)}</span>
              ) : null}
            </div>
            <WidgetPreview
              type={type}
              config={previewConfig as Record<string, unknown>}
              state={state.data ?? null}
              alertScenario={alertScenario}
            />
          </Card>

          <WidgetStateControls widget={widget.data} />

          <OverlayTokens widgetId={id} />
        </aside>
      </div>
    </div>
  );
}

/**
 * Сохранение — рядом с предпросмотром, а не под формой.
 *
 * Статус словом: «есть несохранённые изменения» видно, не угадывая по кнопке.
 * На узком экране панель прибита к низу окна — колонка с предпросмотром там
 * уходит под форму, и кнопка снова оказалась бы в конце страницы.
 *
 * Кнопка отправляет форму атрибутом `form`, а не вложенностью: правая колонка
 * держит свои поля (стартовая сумма цели), и Enter в них не должен сохранять
 * настройки виджета.
 */
function SaveBar({
  dirty,
  saving,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onDiscard: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface px-4 py-3 shadow-[0_-8px_24px_rgb(0_0_0/0.35)]',
        'lg:static lg:rounded-card lg:border lg:shadow-none',
        dirty && 'lg:border-accent/60',
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p role="status" className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn(
              'h-2 w-2 shrink-0 rounded-full transition-colors duration-200',
              dirty ? 'bg-warning' : 'bg-success',
            )}
          />
          <span className={dirty ? 'text-fg' : 'text-muted'}>
            {dirty ? t('widgets.editor.dirty') : t('widgets.editor.clean')}
          </span>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={!dirty || saving}>
            {t('widgets.editor.discard')}
          </Button>
          {/* Подпись для диктора уточняет, ЧТО сохраняется: в той же колонке
              есть «Сохранить» стартовой суммы цели. */}
          <Button
            type="submit"
            form={FORM_ID}
            isLoading={saving}
            disabled={!dirty}
            aria-label={t('widgets.editor.save')}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
