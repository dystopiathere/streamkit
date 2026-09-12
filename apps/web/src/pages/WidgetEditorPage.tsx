import { zodResolver } from '@hookform/resolvers/zod';
import {
  ALERT_TEMPLATE_VARS,
  type AlertWidgetConfig,
  alertWidgetConfigSchema,
} from '@streamkit/contracts';
import { AlertAnimationStyles, AlertCard } from '@streamkit/ui';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, FieldError, Input, Label } from '@/components/ui';
import { OverlayTokens } from '@/features/widgets/OverlayTokens';
import { useUpdateWidget, useWidget } from '@/features/widgets/queries';
import { ApiError } from '@/lib/api';

/** Событие-пустышка для предпросмотра: показывает, как алерт выглядит в эфире. */
const PREVIEW_EVENT = {
  username: 'Зритель',
  message: 'Спасибо за стрим! Держи на кофе.',
  amount: { amountMinor: 50_000, currency: 'RUB' as const },
  type: 'donation' as const,
};

export function WidgetEditorPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const widget = useWidget(id);
  const updateWidget = useUpdateWidget(id);

  const form = useForm<AlertWidgetConfig>({
    resolver: zodResolver(alertWidgetConfigSchema),
    // Значения приходят асинхронно, поэтому форма наполняется через reset ниже.
    defaultValues: alertWidgetConfigSchema.parse({}),
  });

  useEffect(() => {
    if (widget.data) {
      form.reset(widget.data.config);
    }
  }, [widget.data, form]);

  // Предпросмотр обновляется на каждое изменение поля: подбирать размер шрифта
  // и цвет обводки вслепую, сохраняя и переключаясь в OBS, невозможно.
  const previewConfig = form.watch();

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateWidget.mutateAsync({ config: values });
      toast.success(t('common.save'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  });

  if (widget.isLoading) {
    return <p className="text-muted">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/widgets" className="text-sm text-muted hover:text-fg">
          ← {t('common.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{widget.data?.name}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <form onSubmit={onSubmit} className="space-y-5">
          <Card className="space-y-4">
            <h2 className="font-medium">{t('widgets.section.behavior')}</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="layout">{t('widgets.field.layout')}</Label>
                <select
                  id="layout"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  {...form.register('layout')}
                >
                  <option value="center">center</option>
                  <option value="banner">banner</option>
                  <option value="side">side</option>
                </select>
              </div>

              <NumberField
                form={form}
                name="durationMs"
                label={t('widgets.field.durationMs')}
                step={500}
              />
              <NumberField form={form} name="gapMs" label={t('widgets.field.gapMs')} step={100} />
              <NumberField
                form={form}
                name="minAmountMinor"
                label={t('widgets.field.minAmount')}
                step={100}
              />

              <div>
                <Label htmlFor="animationIn">{t('widgets.field.animationIn')}</Label>
                <select
                  id="animationIn"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  {...form.register('animationIn')}
                >
                  {['fade', 'slide-up', 'slide-left', 'zoom', 'bounce'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="animationOut">{t('widgets.field.animationOut')}</Label>
                <select
                  id="animationOut"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  {...form.register('animationOut')}
                >
                  {['fade', 'slide-up', 'slide-left', 'zoom', 'bounce'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="font-medium">{t('widgets.section.text')}</h2>

            <div>
              <Label htmlFor="titleTemplate">{t('widgets.field.titleTemplate')}</Label>
              <Input id="titleTemplate" {...form.register('titleTemplate')} />
              <p className="mt-1 text-xs text-muted">
                {t('widgets.templateHint', {
                  vars: ALERT_TEMPLATE_VARS.map((name) => `{${name}}`).join(', '),
                })}
              </p>
              <FieldError message={form.formState.errors.titleTemplate?.message} />
            </div>

            <div>
              <Label htmlFor="messageTemplate">{t('widgets.field.messageTemplate')}</Label>
              <Input id="messageTemplate" {...form.register('messageTemplate')} />
              <FieldError message={form.formState.errors.messageTemplate?.message} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                form={form}
                name="text.fontSize"
                label={t('widgets.field.fontSize')}
                step={1}
              />
              <NumberField
                form={form}
                name="text.strokeWidth"
                label={t('widgets.field.strokeWidth')}
                step={1}
              />
              <ColorField form={form} name="text.color" label={t('widgets.field.color')} />
              <ColorField
                form={form}
                name="text.highlightColor"
                label={t('widgets.field.highlightColor')}
              />
            </div>
          </Card>

          <Button type="submit" isLoading={updateWidget.isPending}>
            {t('common.save')}
          </Button>
        </form>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-medium">{t('widgets.preview')}</h2>
            {/* Клетчатый фон вместо сплошного: у оверлея прозрачный фон, и на
                однотонной подложке невозможно оценить читаемость обводки. */}
            <div
              className="flex h-64 items-center justify-center rounded-lg"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #2a2a35 25%, transparent 25%), linear-gradient(-45deg, #2a2a35 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a35 75%), linear-gradient(-45deg, transparent 75%, #2a2a35 75%)',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
              }}
            >
              <AlertAnimationStyles />
              <AlertCard event={PREVIEW_EVENT} config={previewConfig} animate={false} />
            </div>
          </Card>

          <OverlayTokens widgetId={id} />
        </div>
      </div>
    </div>
  );
}

type FieldPath = 'durationMs' | 'gapMs' | 'minAmountMinor' | 'text.fontSize' | 'text.strokeWidth';

function NumberField({
  form,
  name,
  label,
  step,
}: {
  form: ReturnType<typeof useForm<AlertWidgetConfig>>;
  name: FieldPath;
  label: string;
  step: number;
}): React.JSX.Element {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type="number"
        step={step}
        // valueAsNumber обязателен: без него в схему уедет строка, и Zod
        // отвергнет форму с невнятной ошибкой про тип.
        {...form.register(name, { valueAsNumber: true })}
      />
    </div>
  );
}

function ColorField({
  form,
  name,
  label,
}: {
  form: ReturnType<typeof useForm<AlertWidgetConfig>>;
  name: 'text.color' | 'text.highlightColor';
  label: string;
}): React.JSX.Element {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <div className="flex gap-2">
        <input
          id={name}
          type="color"
          className="h-9 w-12 rounded border border-border bg-bg"
          {...form.register(name)}
        />
        <Input {...form.register(name)} />
      </div>
    </div>
  );
}
