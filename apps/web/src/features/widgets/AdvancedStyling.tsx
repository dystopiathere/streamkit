import {
  BACKGROUND_FITS,
  FONT_FAMILIES,
  hasWidgetBackground,
  type WidgetSlot,
  WIDGET_SLOTS,
  type WidgetType,
} from '@streamkit/contracts';
import { useRef } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, Card, cn, Label } from '@streamkit/app-kit';
import { PlanPaywall, usePlanAccess } from '@/features/billing/PlanPaywall';
import { NullableColorField, NumberField, SelectField, TextField } from './fields';

/**
 * Продвинутое оформление: раскладка элементов в кадре, шрифт, фон и картинки.
 *
 * Отдельным блоком, а не вперемешку с остальными настройками, по двум причинам.
 * Первая — тариф: без «Про» весь блок заблокирован, и граница должна быть видна,
 * а не угадываться по отдельным серым полям. Вторая — раскладка бесполезна по
 * одному полю: элемент ставят, глядя на кадр целиком.
 *
 * Значения при этом СОХРАНЯЮТСЯ и без тарифа (сервер их не стирает), поэтому
 * заблокированные поля показывают то, что настроено: вернув «Про», стример
 * получит своё оформление обратно, а не пустую форму.
 */
export function AdvancedStylingCard({
  form,
  type,
  prefix = '',
}: {
  form: UseFormReturn<FieldValues>;
  type: WidgetType;
  /** Префикс пути в форме: у алертов настройки лежат в сценарии события. */
  prefix?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const allowed = usePlanAccess('advancedStyling');
  const slots = WIDGET_SLOTS[type as keyof typeof WIDGET_SLOTS] as readonly string[] | undefined;

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-medium">{t('widgets.section.advanced')}</h2>
        <p className="text-xs text-muted">{t('widgets.hint.advanced')}</p>
      </div>

      {allowed ? null : <PlanPaywall gate="advancedStyling" />}

      {/* fieldset disabled, а не скрытие: настроенное оформление видно и без
          тарифа — вместе с плашкой это объясняет, что именно вернёт оплата. */}
      <fieldset disabled={!allowed} className={cn('space-y-5', !allowed && 'opacity-60')}>
        <SelectField
          form={form}
          name={`${prefix}text.fontFamily`}
          label={t('widgets.field.fontFamily')}
          options={FONT_FAMILIES.map((value) => ({ value, label: value }))}
        />

        {slots ? <LayoutCanvas form={form} prefix={prefix} slots={slots} /> : null}

        {/* У гостей фона нет: кадр занимают плитки с видео, и подложка под ними
            не видна. Такие поля лучше не рисовать вовсе — схема выбросила бы их
            при сохранении молча, и стример правил бы настройку, которой нет. */}
        {hasWidgetBackground(type) ? (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('widgets.section.background')}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <NullableColorField
                form={form}
                name={`${prefix}background.color`}
                label={t('widgets.field.backgroundColor')}
              />
              <SelectField
                form={form}
                name={`${prefix}background.fit`}
                label={t('widgets.field.backgroundFit')}
                options={BACKGROUND_FITS.map((value) => ({
                  value,
                  label: t(`widgets.backgroundFit.${value}`),
                }))}
              />
              <NumberField
                form={form}
                name={`${prefix}background.opacity`}
                label={t('widgets.field.backgroundOpacity')}
                step={0.05}
              />
              <NumberField
                form={form}
                name={`${prefix}background.cornerRadius`}
                label={t('widgets.field.cornerRadius')}
              />
            </div>
            <TextField
              form={form}
              name={`${prefix}background.imageUrl`}
              label={t('widgets.field.backgroundImage')}
              hint={t('widgets.hint.imageUrl')}
              nullable
            />
          </div>
        ) : null}

        {type === 'goal' ? (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('widgets.section.barImages')}</h3>
            <TextField
              form={form}
              name="barImageUrl"
              label={t('widgets.field.barImage')}
              hint={t('widgets.hint.barImage')}
              nullable
            />
            <TextField
              form={form}
              name="trackImageUrl"
              label={t('widgets.field.trackImage')}
              nullable
            />
          </div>
        ) : null}
      </fieldset>
    </Card>
  );
}

/** Куда ставится элемент, которому позицию ещё не задали: по смыслу его места. */
const FIRST_POSITION: Record<string, { x: number; y: number }> = {
  image: { x: 50, y: 30 },
  title: { x: 50, y: 20 },
  message: { x: 50, y: 70 },
  bar: { x: 50, y: 50 },
  amount: { x: 50, y: 80 },
  clock: { x: 50, y: 55 },
  list: { x: 50, y: 60 },
};

/** Шаг клавиатуры в процентах кадра. С Shift — крупный: пройти кадр за десяток нажатий. */
const STEP = 1;
const BIG_STEP = 10;

/**
 * Кадр с перетаскиваемыми элементами.
 *
 * Мышью — и клавиатурой: раскладка только указателем закрыла бы функцию тем, кто
 * работает с клавиатуры (WCAG 2.1.1). Поэтому элемент — это кнопка: Tab выбирает,
 * стрелки двигают, а рядом стоят числовые поля X и Y для точного значения.
 *
 * Координаты — проценты кадра, а не пиксели: размер браузер-сорса в OBS задаёт
 * стример, и пиксели разъехались бы у каждого по-своему. Кадр здесь 16:9 —
 * обычная сцена OBS; сам виджет показывается в предпросмотре рядом.
 */
function LayoutCanvas({
  form,
  prefix,
  slots,
}: {
  form: UseFormReturn<FieldValues>;
  prefix: string;
  slots: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const at = (slot: string, field: string): string => `${prefix}slots.${slot}.${field}`;

  const read = (slot: string): WidgetSlot => ({
    x: numberOrNull(form.watch(at(slot, 'x'))),
    y: numberOrNull(form.watch(at(slot, 'y'))),
    color: (form.watch(at(slot, 'color')) as string | null) ?? null,
    fontSize: numberOrNull(form.watch(at(slot, 'fontSize'))),
  });

  const put = (slot: string, x: number, y: number): void => {
    form.setValue(at(slot, 'x'), clamp(x), { shouldDirty: true });
    form.setValue(at(slot, 'y'), clamp(y), { shouldDirty: true });
  };

  const drag = (slot: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    // Элемент берётся в переменную СРАЗУ: React обнуляет `currentTarget` у
    // события, как только обработчик вернул управление, а слушатели ниже живут
    // до отпускания кнопки мыши.
    const target = event.currentTarget;
    // Захват указателя на самой кнопке: без него курсор, вышедший за пределы
    // кадра, «отпускает» элемент там, где мышь уже не над ним.
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent): void => {
      put(
        slot,
        ((moveEvent.clientX - box.left) / box.width) * 100,
        ((moveEvent.clientY - box.top) / box.height) * 100,
      );
    };
    const stop = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', stop);
      target.removeEventListener('pointercancel', stop);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', stop);
    // Отмена указателя (системный жест, потеря фокуса окна) не даёт `pointerup`,
    // и без этой строки элемент продолжал бы ездить за мышью после отпускания.
    target.addEventListener('pointercancel', stop);
  };

  const nudge = (slot: string) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const shift = ARROWS[event.key];
    if (!shift) return;
    event.preventDefault();
    const current = read(slot);
    const start = FIRST_POSITION[slot] ?? { x: 50, y: 50 };
    put(slot, (current.x ?? start.x) + shift.x * step, (current.y ?? start.y) + shift.y * step);
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{t('widgets.section.layout')}</h3>
        <p className="text-xs text-muted">{t('widgets.hint.layout')}</p>
      </div>

      {/* Клетчатый фон — как в предпросмотре: на однотонной подложке не видно,
          где кадр прозрачен. */}
      <div
        ref={frame}
        className="relative aspect-video w-full overflow-hidden rounded-lg border border-border-strong"
        style={{
          backgroundImage:
            'linear-gradient(45deg, #2a2a35 25%, transparent 25%), linear-gradient(-45deg, #2a2a35 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a35 75%), linear-gradient(-45deg, transparent 75%, #2a2a35 75%)',
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        }}
      >
        {slots.map((slot) => {
          const value = read(slot);
          const placed = value.x !== null && value.y !== null;
          const spot = placed
            ? { x: value.x!, y: value.y! }
            : (FIRST_POSITION[slot] ?? { x: 50, y: 50 });
          return (
            <button
              key={slot}
              type="button"
              // Кнопка, а не div с onMouseDown: её берёт Tab, и стрелки работают
              // без дополнительных ролей и tabIndex.
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-md border px-2 py-1 text-xs',
                placed
                  ? 'border-accent bg-accent/80 text-accent-fg'
                  : 'border-dashed border-border-strong bg-bg/80 text-muted',
              )}
              style={{ left: `${spot.x}%`, top: `${spot.y}%`, touchAction: 'none' }}
              onPointerDown={drag(slot)}
              onKeyDown={nudge(slot)}
              aria-label={t('widgets.layout.element', {
                element: t(`widgets.slot.${slot}`),
                x: Math.round(spot.x),
                y: Math.round(spot.y),
              })}
            >
              {t(`widgets.slot.${slot}`)}
            </button>
          );
        })}
      </div>

      {slots.map((slot) => (
        <div key={slot} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label>{t(`widgets.slot.${slot}`)}</Label>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                form.setValue(at(slot, 'x'), null, { shouldDirty: true });
                form.setValue(at(slot, 'y'), null, { shouldDirty: true });
              }}
            >
              {t('widgets.layout.reset')}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {/* nullable: пустое поле значит «как в потоке», а не ноль процентов. */}
            <NumberField form={form} name={at(slot, 'x')} label={t('widgets.field.x')} nullable />
            <NumberField form={form} name={at(slot, 'y')} label={t('widgets.field.y')} nullable />
            <NumberField
              form={form}
              name={at(slot, 'fontSize')}
              label={t('widgets.field.size')}
              nullable
            />
            <NullableColorField
              form={form}
              name={at(slot, 'color')}
              label={t('widgets.field.color')}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const ARROWS: Record<string, { x: number; y: number } | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function clamp(value: number): number {
  // Округление до десятых: проценты с шестью знаками после запятой в конфиге
  // ничего не добавляют, а diff настроек делают нечитаемым.
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/** Пустое поле формы — это `null`, а не `NaN`: `valueAsNumber` на пустом даёт NaN. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
