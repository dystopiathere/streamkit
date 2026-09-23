import {
  DEFAULT_GUEST_SEATS,
  GUEST_TILE_ASPECT,
  guestSeat,
  type GuestSeat,
  MAX_GUESTS_PER_ROOM,
  type WidgetCanvas,
} from '@streamkit/contracts';
import { type ReactNode, useRef, useState } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@streamkit/app-kit';
import { WidgetStage } from '@streamkit/ui';
import { FrameGuides } from './FrameGuides';
import { snapToGrid, stepToGrid } from './grid';
import { RangeField } from './fields';
import { CanvasFrame } from './WidgetPreview';

/** Шаг клавиатуры в процентах кадра; с Shift место идёт по сетке (`grid.ts`). */
const STEP = 1;
/** Кадр без заданного окна виджета — 16:9, как обычная сцена OBS. */
const DEFAULT_FRAME_ASPECT = 16 / 9;

/**
 * Высота плитки 16:9 в процентах высоты кадра при ширине `width` процентов его
 * ширины. В кадре 16:9 доли равны; в окне 800×600 плитка той же ширины ниже.
 */
function heightIn(width: number, frameAspect: number): number {
  return (width * frameAspect) / GUEST_TILE_ASPECT;
}

/** Меньше пяти процентов плитка — уже не видео, а цветная точка. */
const MIN_SIZE = 5;
/** Сколько надо сдвинуть указатель, чтобы щелчок стал переносом. */
const DRAG_THRESHOLD_PX = 3;

const ARROWS: Record<string, { x: number; y: number } | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * Свободная раскладка гостей: рамка каждого места в кадре.
 *
 * Места — по порядку входа: первый гость встаёт в первое место. Рамку двигают
 * за середину и растягивают за нижний правый угол; плитка всегда 16:9, поэтому
 * угол меняет только ширину. С клавиатуры: Tab выбирает место, стрелки
 * двигают, Alt со стрелками меняет размер, а под кадром — ползунки положения и
 * ширины (WCAG 2.1.1: раскладка только мышью закрыла бы функцию).
 *
 * Показаны только места, которые может занять гость (`maxTiles`): остальные
 * хранятся в конфиге, но в кадре их не будет, и двигать их незачем.
 *
 * Гейта тарифа здесь нет: без «Про» комнаты не работают целиком, и виджет гостей
 * без тарифа ничего не показывает.
 */
export function GuestSeatsCanvas({
  form,
  underlay,
  canvas,
}: {
  form: UseFormReturn<FieldValues>;
  /** Окно виджета: кадр в его пропорциях и координаты в пикселях. */
  canvas: WidgetCanvas | null;
  /** Настоящий виджет гостей под рамками: двигают то, что будет в кадре. */
  underlay?: ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const frameAspect = canvas ? canvas.width / canvas.height : DEFAULT_FRAME_ASPECT;
  const heightOf = (width: number): number => heightIn(width, frameAspect);
  const toPixelsX = canvas ? canvas.width / 100 : 1;
  const toPixelsY = canvas ? canvas.height / 100 : 1;
  const unit = canvas ? 'px' : '%';
  const [selected, setSelected] = useState(0);
  const [active, setActive] = useState<{ index: number; mode: 'move' | 'resize' } | null>(null);
  // Держат Shift во время переноса: место идёт по клеткам, и клетки видны ярче.
  const [snapping, setSnapping] = useState(false);

  const count = Math.min(
    MAX_GUESTS_PER_ROOM,
    Math.max(1, Number(form.watch('maxTiles')) || MAX_GUESTS_PER_ROOM),
  );
  const current = Math.min(selected, count - 1);
  const at = (index: number, field: keyof GuestSeat): string => `seats.${index}.${field}`;

  const read = (index: number): GuestSeat => {
    const fallback = guestSeat([], index);
    const value = (field: keyof GuestSeat): number => {
      const raw = Number(form.watch(at(index, field)));
      return Number.isFinite(raw) && form.watch(at(index, field)) !== undefined
        ? raw
        : fallback[field];
    };
    return { x: value('x'), y: value('y'), width: value('width') };
  };

  const write = (index: number, seat: GuestSeat): void => {
    const fitted = fit(seat, frameAspect);
    // По листьям, а не объектом места: react-hook-form не переносит значение
    // объекта в уже зарегистрированные под ним ползунки.
    for (const field of ['x', 'y', 'width'] as const) {
      form.setValue(at(index, field), fitted[field], { shouldDirty: true });
    }
  };

  const resetAll = (): void => {
    DEFAULT_GUEST_SEATS.forEach((seat, index) => write(index, seat));
  };
  const customized = DEFAULT_GUEST_SEATS.slice(0, count).some((seat, index) => {
    const value = read(index);
    return value.x !== seat.x || value.y !== seat.y || value.width !== seat.width;
  });

  const startDrag =
    (index: number, mode: 'move' | 'resize') => (event: React.PointerEvent<HTMLElement>) => {
      if (active || event.button !== 0) return;
      // Угол — внутри рамки: без этого нажатие на угол начало бы ещё и перенос.
      event.stopPropagation();
      const box = frame.current?.getBoundingClientRect();
      if (!box) return;
      setSelected(index);
      // Элемент — в переменную сразу: React обнуляет `currentTarget` после
      // обработчика, а слушатели ниже живут до отпускания кнопки.
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const start = read(index);
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;

      const move = (moveEvent: PointerEvent): void => {
        const dxPx = moveEvent.clientX - startX;
        const dyPx = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
        if (!moved) {
          moved = true;
          setActive({ index, mode });
        }
        const dx = (dxPx / box.width) * 100;
        const dy = (dyPx / box.height) * 100;
        // Shift читается из каждого движения, а не из начала жеста: его жмут и
        // отпускают посреди переноса.
        const grid = moveEvent.shiftKey;
        setSnapping(grid);
        if (mode === 'move') {
          const x = start.x + dx;
          const y = start.y + dy;
          // Магнитится середина места — по ней его и ставят: на линии сетки
          // оказывается центр плитки, а не её угол.
          write(index, { ...start, x: grid ? snapToGrid(x) : x, y: grid ? snapToGrid(y) : y });
          return;
        }
        // Угол тянется от неподвижного верхнего левого края рамки. Высоту даёт
        // соотношение сторон, поэтому ширина берётся по большему из сдвигов:
        // тянут и вбок, и вниз, и плитка растёт за тем, что заметнее.
        const left = start.x - start.width / 2;
        const top = start.y - heightOf(start.width) / 2;
        const grow = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
        const grown = start.width + grow;
        const width = Math.max(MIN_SIZE, grid ? snapToGrid(grown) : grown);
        write(index, { x: left + width / 2, y: top + heightOf(width) / 2, width });
      };
      const stop = (): void => {
        setActive(null);
        setSnapping(false);
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', stop);
        target.removeEventListener('pointercancel', stop);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', stop);
      // Системный жест или потеря фокуса окна не дают `pointerup`.
      target.addEventListener('pointercancel', stop);
    };

  const nudge = (index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const shift = ARROWS[event.key];
    if (!shift) return;
    event.preventDefault();
    const seat = read(index);
    // Shift ведёт по сетке — на следующую её линию, а не «на десять процентов»:
    // иначе от произвольной позиции на линию не попасть, а значит и не выровнять
    // два места друг с другом.
    const along = (value: number, direction: number): number =>
      direction === 0
        ? value
        : event.shiftKey
          ? stepToGrid(value, direction)
          : value + direction * STEP;
    if (event.altKey) {
      // Размер — от верхнего левого края, как при растягивании за угол:
      // вправо и вниз — крупнее, влево и вверх — мельче.
      const left = seat.x - seat.width / 2;
      const top = seat.y - heightOf(seat.width) / 2;
      const width = Math.max(MIN_SIZE, along(seat.width, shift.x + shift.y));
      write(index, { x: left + width / 2, y: top + heightOf(width) / 2, width });
      return;
    }
    write(index, { ...seat, x: along(seat.x, shift.x), y: along(seat.y, shift.y) });
  };

  const seatName = (index: number): string => t('widgets.seats.seat', { number: index + 1 });
  const selectedSeat = read(current);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <h3 className="text-sm font-medium">{t('widgets.seats.title')}</h3>
          <p className="mt-0.5 text-xs text-muted">{t('widgets.seats.hint')}</p>
        </div>
        <Button type="button" variant="secondary" onClick={resetAll} disabled={!customized}>
          {t('widgets.layout.resetAll')}
        </Button>
      </div>

      <SeatsFrame canvas={canvas} frameRef={frame}>
        <FrameGuides snapping={snapping} />
        {underlay ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-90">
            <WidgetStage canvas={canvas}>{underlay}</WidgetStage>
          </div>
        ) : null}

        {Array.from({ length: count }, (_, index) => {
          const seat = read(index);
          const isSelected = index === current;
          const isActive = active?.index === index;
          return (
            <button
              key={index}
              type="button"
              aria-pressed={isSelected}
              aria-label={t('widgets.seats.label', {
                seat: seatName(index),
                x: Math.round(seat.x),
                y: Math.round(seat.y),
                width: Math.round(seat.width),
              })}
              className={cn(
                'absolute grid place-items-center rounded-md border text-xs font-medium',
                'transition-[box-shadow,background-color] duration-150 ease-out',
                isActive && active?.mode === 'move' ? 'cursor-grabbing' : 'cursor-grab',
                isSelected
                  ? 'z-10 border-fg bg-fg/15 text-fg ring-2 ring-accent ring-offset-2 ring-offset-bg'
                  : 'border-border-strong bg-bg/40 text-muted',
              )}
              style={{
                left: `${seat.x - seat.width / 2}%`,
                top: `${seat.y - heightOf(seat.width) / 2}%`,
                width: `${seat.width}%`,
                height: `${heightOf(seat.width)}%`,
              }}
              onPointerDown={startDrag(index, 'move')}
              onFocus={() => setSelected(index)}
              onKeyDown={nudge(index)}
            >
              <span className="rounded bg-bg/85 px-1.5 py-0.5">{index + 1}</span>
              {/* Угол для растягивания. Без роли: размер с клавиатуры меняют
                  Alt со стрелками и ползунки под кадром. */}
              <span
                aria-hidden="true"
                data-testid="seat-resize"
                onPointerDown={startDrag(index, 'resize')}
                className={cn(
                  'absolute right-0 bottom-0 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-sm border border-bg',
                  isSelected ? 'bg-accent' : 'bg-border-strong',
                )}
              />
            </button>
          );
        })}
      </SeatsFrame>

      <div className="space-y-4 rounded-lg border border-border bg-bg/40 p-4">
        <p className="text-sm font-medium">{seatName(current)}</p>
        <div key={current} className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <RangeField
            form={form}
            name={at(current, 'x')}
            label={t('widgets.field.x')}
            min={0}
            max={canvas ? canvas.width : 100}
            step={canvas ? 1 : 0.5}
            scale={toPixelsX}
            unit={unit}
            fallback={Math.round(selectedSeat.x * toPixelsX)}
          />
          <RangeField
            form={form}
            name={at(current, 'y')}
            label={t('widgets.field.y')}
            min={0}
            max={canvas ? canvas.height : 100}
            step={canvas ? 1 : 0.5}
            scale={toPixelsY}
            unit={unit}
            fallback={Math.round(selectedSeat.y * toPixelsY)}
          />
          <RangeField
            form={form}
            name={at(current, 'width')}
            label={t('widgets.seats.width')}
            min={MIN_SIZE}
            max={canvas ? canvas.width : 100}
            step={canvas ? 1 : 0.5}
            scale={toPixelsX}
            unit={unit}
            fallback={Math.round(selectedSeat.width * toPixelsX)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Рамка целиком в кадре: размер не больше кадра, середина — так, чтобы края не
 * выходили за него. Плитка, наполовину уехавшая за край, в OBS просто обрезана,
 * и заметить это можно только в эфире.
 */
export function fit(seat: GuestSeat, frameAspect = DEFAULT_FRAME_ASPECT): GuestSeat {
  // Плитка не выше кадра: в окне, более узком, чем 16:9, ширину ограничивает
  // высота кадра.
  const widest = Math.min(100, (100 * GUEST_TILE_ASPECT) / frameAspect);
  const width = round(Math.min(widest, Math.max(MIN_SIZE, seat.width)));
  const height = heightIn(width, frameAspect);
  return {
    width,
    x: round(Math.min(100 - width / 2, Math.max(width / 2, seat.x))),
    y: round(Math.min(100 - height / 2, Math.max(height / 2, seat.y))),
  };
}

/** Десятые доли процента: больше точности кадр не различит, а конфиг раздует. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Рамка кадра мест: в пропорциях окна виджета, без окна — 16:9. */
function SeatsFrame({
  canvas,
  frameRef,
  children,
}: {
  canvas: WidgetCanvas | null;
  frameRef: React.Ref<HTMLDivElement>;
  children: ReactNode;
}): React.JSX.Element {
  const className = 'checkerboard touch-none rounded-lg border border-border-strong select-none';
  return canvas ? (
    <CanvasFrame canvas={canvas} frameRef={frameRef} testId="guest-seats" className={className}>
      {children}
    </CanvasFrame>
  ) : (
    <div
      ref={frameRef}
      data-testid="guest-seats"
      className={`relative aspect-video w-full overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}
