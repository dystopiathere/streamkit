import { CANVAS_PRESETS, DEFAULT_WIDGET_CANVAS, type WidgetCanvas } from '@streamkit/contracts';
import { useId } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, Label, selectClasses } from '@streamkit/app-kit';
import { NumberField } from './fields';
import { canvasOf } from './WidgetPreview';

/**
 * Окно виджета — ширина и высота браузер-сорса в OBS.
 *
 * Стоит рядом с предпросмотром, а не в разделах формы: от него зависят и
 * предпросмотр, и кадр раскладки, и меняют его, глядя на них. Сохраняется
 * вместе с остальными настройками.
 */
export function CanvasSize({ form }: { form: UseFormReturn<FieldValues> }): React.JSX.Element {
  const { t } = useTranslation();
  const presetId = useId();
  const canvas = canvasOf({ canvas: form.watch('canvas') });

  // По листьям: react-hook-form не переносит объект в зарегистрированные поля.
  const apply = (next: WidgetCanvas): void => {
    form.setValue('canvas.width', next.width, { shouldDirty: true });
    form.setValue('canvas.height', next.height, { shouldDirty: true });
  };

  if (!canvas && form.watch('canvas') === null) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted">{t('widgets.canvas.unset')}</p>
        <Button type="button" variant="secondary" onClick={() => apply(DEFAULT_WIDGET_CANVAS)}>
          {t('widgets.canvas.set', DEFAULT_WIDGET_CANVAS)}
        </Button>
      </div>
    );
  }

  const presetValue = canvas
    ? CANVAS_PRESETS.find(
        (preset) => preset.width === canvas.width && preset.height === canvas.height,
      )
      ? `${canvas.width}x${canvas.height}`
      : 'custom'
    : 'custom';

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={presetId}>{t('widgets.canvas.preset')}</Label>
        <select
          id={presetId}
          className={`${selectClasses} mt-1`}
          value={presetValue}
          onChange={(event) => {
            const [width, height] = event.target.value.split('x').map(Number);
            if (width && height) apply({ width, height });
          }}
        >
          {CANVAS_PRESETS.map((preset) => (
            <option
              key={`${preset.width}x${preset.height}`}
              value={`${preset.width}x${preset.height}`}
            >
              {preset.width} × {preset.height}
            </option>
          ))}
          <option value="custom" disabled>
            {t('widgets.canvas.custom')}
          </option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField form={form} name="canvas.width" label={t('widgets.canvas.width')} />
        <NumberField form={form} name="canvas.height" label={t('widgets.canvas.height')} />
      </div>
      <p className="text-xs text-muted">{t('widgets.canvas.hint')}</p>
      <Button
        type="button"
        variant="ghost"
        className="px-2 py-1 text-xs"
        onClick={() => form.setValue('canvas', null, { shouldDirty: true })}
      >
        {t('widgets.canvas.clear')}
      </Button>
    </div>
  );
}
