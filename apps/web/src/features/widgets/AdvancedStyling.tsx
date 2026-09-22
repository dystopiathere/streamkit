import {
  type AlertEventType,
  BACKGROUND_FITS,
  type WidgetState,
  EMPTY_SLOT,
  FONT_FAMILIES,
  hasWidgetBackground,
  type WidgetSlot,
  WIDGET_SLOTS,
  type WidgetType,
} from '@streamkit/contracts';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@streamkit/app-kit';
import { PlanPaywall, usePlanAccess } from '@/features/billing/PlanPaywall';
import { NullableColorField, RangeField, SelectField, TextField } from './fields';
import { FrameGuides } from './FrameGuides';
import { WidgetSurface } from './WidgetPreview';

/**
 * Продвинутое оформление: раскладка элементов в кадре, шрифт, фон и картинки.
 *
 * Два раздела редактора, а не один блок: раскладку ставят, глядя на кадр
 * целиком, и ей нужен весь экран раздела, а шрифт и фон — обычные поля.
 *
 * Без «Про» раздел целиком в `fieldset disabled` с плашкой: граница тарифа
 * должна читаться сразу, а не угадываться по отдельным серым полям. Значения при
 * этом СОХРАНЯЮТСЯ и без тарифа (сервер их не стирает), поэтому заблокированные
 * поля показывают то, что настроено: вернув «Про», стример получит своё
 * оформление обратно, а не пустую форму.
 */
function ProGate({ children }: { children: ReactNode }): React.JSX.Element {
  const allowed = usePlanAccess('advancedStyling');
  return (
    <div className="space-y-5">
      {allowed ? null : <PlanPaywall gate="advancedStyling" />}
      <fieldset disabled={!allowed} className={cn('space-y-6', !allowed && 'opacity-60')}>
        {children}
      </fieldset>
    </div>
  );
}

export function LayoutSection({
  form,
  type,
  prefix = '',
  scenario = 'donation',
  state = null,
}: {
  form: UseFormReturn<FieldValues>;
  type: WidgetType;
  /** Префикс пути в форме: у алертов настройки лежат в сценарии события. */
  prefix?: string;
  /** Сценарий оповещений, чья карточка лежит под ручками. */
  scenario?: AlertEventType;
  /** То же состояние, что у предпросмотра: два «настоящих» рендера на одной странице не должны спорить. */
  state?: WidgetState | null;
}): React.JSX.Element | null {
  const allowed = usePlanAccess('advancedStyling');
  const slots = WIDGET_SLOTS[type as keyof typeof WIDGET_SLOTS] as readonly string[] | undefined;
  if (!slots) return null;
  return (
    <ProGate>
      <LayoutCanvas
        locked={!allowed}
        form={form}
        prefix={prefix}
        slots={slots}
        underlay={
          <WidgetSurface
            type={type}
            config={form.watch() as Record<string, unknown>}
            state={state}
            alertScenario={scenario}
          />
        }
      />
    </ProGate>
  );
}

export function StyleSection({
  form,
  type,
  prefix = '',
}: {
  form: UseFormReturn<FieldValues>;
  type: WidgetType;
  prefix?: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <ProGate>
      <SelectField
        form={form}
        name={`${prefix}text.fontFamily`}
        label={t('widgets.field.fontFamily')}
        options={FONT_FAMILIES.map((value) => ({ value, label: value }))}
      />

      {/* У гостей фона нет: кадр занимают плитки с видео, и подложка под ними
          не видна. Такие поля лучше не рисовать вовсе — схема выбросила бы их
          при сохранении молча, и стример правил бы настройку, которой нет. */}
      {hasWidgetBackground(type) ? (
        <div className="space-y-5 border-t border-border pt-5">
          <h3 className="text-sm font-medium">{t('widgets.section.background')}</h3>
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
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
            {/* Проценты, а не доля единицы: так её называют все редакторы
                картинок, и «0,35» никто не держит в голове. Хранится 0–1. */}
            <RangeField
              form={form}
              name={`${prefix}background.opacity`}
              label={t('widgets.field.backgroundOpacity')}
              min={0}
              max={100}
              scale={100}
              unit="%"
              hint={t('widgets.hint.backgroundOpacity')}
            />
            <RangeField
              form={form}
              name={`${prefix}background.cornerRadius`}
              label={t('widgets.field.cornerRadius')}
              min={0}
              max={96}
              unit="px"
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
        <div className="space-y-5 border-t border-border pt-5">
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
    </ProGate>
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
 * Выбранный элемент — одно состояние на всё: его обводит кадр, через него идут
 * направляющие, и под кадром — его настройки. Раньше выбор ничем не отмечался:
 * элемент подсвечивался только в движении, и после щелчка было непонятно,
 * выбран он или щелчок пропал. Под кадром тогда стояли настройки ВСЕХ элементов
 * списком, и найти нужный можно было только по подписи.
 *
 * Мышью — и клавиатурой: раскладка только указателем закрыла бы функцию тем, кто
 * работает с клавиатуры (WCAG 2.1.1). Поэтому элемент — это кнопка: Tab выбирает
 * (фокус и есть выбор), стрелки двигают, а в панели под кадром — ползунки X и Y
 * для точного значения.
 *
 * Координаты — проценты кадра, а не пиксели: размер браузер-сорса в OBS задаёт
 * стример, и пиксели разъехались бы у каждого по-своему. Кадр здесь 16:9 —
 * обычная сцена OBS; сам виджет показывается в предпросмотре рядом.
 */
function LayoutCanvas({
  form,
  prefix,
  slots,
  underlay,
  locked = false,
}: {
  form: UseFormReturn<FieldValues>;
  prefix: string;
  slots: readonly string[];
  /** Настоящий виджет под ручками: двигают то, что видно в кадре. */
  underlay?: ReactNode;
  /**
   * Тариф не даёт раскладку. `fieldset disabled` гасит щелчки и клавиши, но не
   * события указателя: без этого флага элемент без «Про» перетаскивался, а
   * форма отмечала несохранённые изменения, которые в кадр всё равно не уйдут.
   */
  locked?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string>(slots[0] ?? '');
  const [dragging, setDragging] = useState<string | null>(null);
  const at = (slot: string, field: string): string => `${prefix}slots.${slot}.${field}`;

  // Где виджет под ручками на самом деле нарисовал элементы без позиции. Без
  // замера ручка такого элемента стояла на условном месте, а сам элемент — в
  // другом углу кадра: «двигаешь то, что видишь» не выполнялось. Замер — после
  // каждого рендера (изменился шрифт или текст — сдвинулся и элемент), но
  // состояние меняется только при заметном сдвиге, иначе рендер зациклится.
  const [measured, setMeasured] = useState<Record<string, { x: number; y: number }>>({});
  useLayoutEffect(() => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    const next: Record<string, { x: number; y: number }> = {};
    for (const slot of slots) {
      const node = frame.current?.querySelector(`[data-slot="${slot}"]`);
      const rect = node?.getBoundingClientRect();
      if (!rect || rect.width === 0) continue;
      next[slot] = {
        x: clamp(((rect.left + rect.width / 2 - box.left) / box.width) * 100),
        y: clamp(((rect.top + rect.height / 2 - box.top) / box.height) * 100),
      };
    }
    const moved = slots.some((slot) => {
      const a = measured[slot];
      const b = next[slot];
      if (!a || !b) return Boolean(a) !== Boolean(b);
      return Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5;
    });
    if (!moved) return;
    // Состояние — в кадре анимации, а не синхронно в эффекте: иначе рендер
    // каскадом перезапускал бы себя в том же кадре.
    const frameId = requestAnimationFrame(() => setMeasured(next));
    return () => cancelAnimationFrame(frameId);
  });
  const restingSpot = (slot: string): { x: number; y: number } =>
    measured[slot] ?? FIRST_POSITION[slot] ?? { x: 50, y: 50 };

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

  const release = (slot: string): void => {
    form.setValue(at(slot, 'x'), null, { shouldDirty: true });
    form.setValue(at(slot, 'y'), null, { shouldDirty: true });
  };

  const anyCustomized = slots.some((slot) => {
    const value = read(slot);
    return value.x !== null || value.y !== null || value.color !== null || value.fontSize !== null;
  });

  // Сброс — ко всему кадру сразу: «вернуть как было» ищут одной кнопкой, а не
  // обходом каждого элемента. Цвет и размер элементов тоже сбрасываются: это
  // та же раскладка, и половинчатый сброс оставил бы непонятную смесь.
  const resetAll = (): void => {
    // По листьям, а не объектом слота: react-hook-form не переносит значение
    // объекта в уже зарегистрированные поля под ним, и ползунки X и Y
    // выбранного элемента оставались бы на старом месте.
    for (const slot of slots) {
      for (const [field, value] of Object.entries(EMPTY_SLOT)) {
        form.setValue(at(slot, field), value, { shouldDirty: true });
      }
    }
  };

  const drag = (slot: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    // Второй палец посреди перетаскивания не должен перехватить элемент.
    if (locked || dragging || event.button !== 0) return;
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    setSelected(slot);
    // Элемент берётся в переменную СРАЗУ: React обнуляет `currentTarget` у
    // события, как только обработчик вернул управление, а слушатели ниже живут
    // до отпускания кнопки мыши.
    const target = event.currentTarget;
    // Захват указателя на самой кнопке: без него курсор, вышедший за пределы
    // кадра, «отпускает» элемент там, где мышь уже не над ним.
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (moveEvent: PointerEvent): void => {
      // Щелчок — это выбор, а не перенос: без порога дрожь руки при щелчке
      // ставила бы элементу, стоящему в потоке, позицию, о которой не просили.
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return;
      if (!moved) {
        moved = true;
        setDragging(slot);
      }
      put(
        slot,
        ((moveEvent.clientX - box.left) / box.width) * 100,
        ((moveEvent.clientY - box.top) / box.height) * 100,
      );
    };
    const stop = (): void => {
      setDragging(null);
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
    if (locked) return;
    const step = event.shiftKey ? BIG_STEP : STEP;
    const shift = ARROWS[event.key];
    if (!shift) return;
    event.preventDefault();
    const current = read(slot);
    const start = restingSpot(slot);
    put(slot, (current.x ?? start.x) + shift.x * step, (current.y ?? start.y) + shift.y * step);
  };

  const active = read(selected);
  const activePlaced = active.x !== null && active.y !== null;
  const slotName = (slot: string): string => t(`widgets.slot.${slot}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <h3 className="text-sm font-medium">{t('widgets.section.layout')}</h3>
          <p className="mt-0.5 text-xs text-muted">{t('widgets.hint.layout')}</p>
        </div>
        <Button type="button" variant="secondary" onClick={resetAll} disabled={!anyCustomized}>
          {t('widgets.layout.resetAll')}
        </Button>
      </div>

      {/* Клетчатый фон — как в предпросмотре: на однотонной подложке не видно,
          где кадр прозрачен. */}
      <div
        ref={frame}
        className="checkerboard relative aspect-video w-full touch-none overflow-hidden rounded-lg border border-border-strong select-none"
      >
        <FrameGuides />
        {underlay ? (
          // Виджет — под ручками и без ввода: щелчок достаётся ручке, а не
          // кнопкам и ссылкам внутри рендерера.
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-90">
            {underlay}
          </div>
        ) : null}

        {/* Направляющие через центр выбранного элемента: по ним видно, что он
            стоит ровно по центру или на одной линии с соседом. */}
        {activePlaced ? (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px bg-accent/50"
              style={{ left: `${active.x}%` }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 h-px bg-accent/50"
              style={{ top: `${active.y}%` }}
            />
          </>
        ) : null}

        {slots.map((slot) => {
          const value = read(slot);
          const placed = value.x !== null && value.y !== null;
          const spot = placed ? { x: value.x!, y: value.y! } : restingSpot(slot);
          const isSelected = slot === selected;
          return (
            <button
              key={slot}
              type="button"
              // Кнопка, а не div с onMouseDown: её берёт Tab, и стрелки работают
              // без дополнительных ролей и tabIndex.
              aria-pressed={isSelected}
              className={cn(
                'absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap',
                'transition-[box-shadow,background-color,transform] duration-150 ease-out',
                locked
                  ? 'cursor-not-allowed'
                  : dragging === slot
                    ? 'cursor-grabbing'
                    : 'cursor-grab',
                placed
                  ? 'border border-accent bg-bg/85 text-fg'
                  : 'border border-dashed border-border-strong bg-bg/85 text-muted',
                isSelected &&
                  'z-10 border-fg bg-fg text-bg shadow-[0_4px_14px_rgb(0_0_0/0.45)] ring-2 ring-accent ring-offset-2 ring-offset-bg',
                dragging === slot && 'scale-105',
              )}
              style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
              onPointerDown={drag(slot)}
              onFocus={() => setSelected(slot)}
              onKeyDown={nudge(slot)}
              aria-label={
                placed
                  ? t('widgets.layout.element', {
                      element: slotName(slot),
                      x: Math.round(spot.x),
                      y: Math.round(spot.y),
                    })
                  : t('widgets.layout.elementInFlow', { element: slotName(slot) })
              }
            >
              {slotName(slot)}
              {isSelected && placed ? (
                <span className="font-normal tabular-nums opacity-80">
                  {Math.round(spot.x)}·{Math.round(spot.y)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Панель выбранного элемента. Подпись статуса — словом: «в потоке» по
          одному пунктиру не прочитать. */}
      <div className="space-y-4 rounded-lg border border-border bg-bg/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            <span className="font-medium">{slotName(selected)}</span>{' '}
            <span className="text-muted">
              — {activePlaced ? t('widgets.layout.placed') : t('widgets.layout.inFlow')}
            </span>
          </p>
          {activePlaced ? (
            <Button type="button" variant="ghost" onClick={() => release(selected)}>
              {t('widgets.layout.reset')}
            </Button>
          ) : null}
        </div>
        <div key={selected} className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <RangeField
            form={form}
            name={at(selected, 'x')}
            label={t('widgets.field.x')}
            min={0}
            max={100}
            step={0.5}
            unit="%"
            nullable
            fallback={Math.round(restingSpot(selected).x)}
            nullLabel={t('widgets.layout.auto')}
          />
          <RangeField
            form={form}
            name={at(selected, 'y')}
            label={t('widgets.field.y')}
            min={0}
            max={100}
            step={0.5}
            unit="%"
            nullable
            fallback={Math.round(restingSpot(selected).y)}
            nullLabel={t('widgets.layout.auto')}
          />
          <RangeField
            form={form}
            name={at(selected, 'fontSize')}
            label={t('widgets.field.size')}
            min={8}
            max={200}
            unit="px"
            nullable
            fallback={Number(form.watch(`${prefix}text.fontSize`)) || 32}
            nullLabel={t('widgets.layout.asText')}
            resetLabel={t('widgets.layout.clear')}
          />
          <NullableColorField
            form={form}
            name={at(selected, 'color')}
            label={t('widgets.field.color')}
          />
        </div>
      </div>
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
