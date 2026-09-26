import type { WidgetCanvas, WidgetConfig } from '@streamkit/contracts';
import { type CSSProperties, type ReactNode, useRef } from 'react';
import { useBoxSize } from './use-box-size';

/**
 * Масштаб, при котором окно виджета целиком помещается в место, где его
 * показывают, без искажения пропорций.
 */
export function canvasScale(canvas: WidgetCanvas, box: { width: number; height: number }): number {
  return Math.min(box.width / canvas.width, box.height / canvas.height);
}

/**
 * Окно виджета: содержимое рисуется ровно в `canvas` пикселей и масштабируется
 * целиком под место, где его показывают, — браузер-сорс OBS, предпросмотр,
 * кадр раскладки.
 *
 * Так позиции (проценты окна) и размеры (пиксели) остаются в одном и том же
 * соотношении везде: в сорсе другого размера виджет крупнее или мельче, но
 * элементы не разъезжаются относительно друг друга. Лишнее место по краям —
 * прозрачное, окно встаёт по центру. Вылезшее за окно обрезается — так же, как
 * в сорсе ровно этого размера.
 *
 * Без окна (`null` — виджеты, настроенные до его появления) содержимое, как
 * раньше, растягивается на всё место.
 *
 * `branding` — подпись бесплатного тарифа в правом нижнем углу окна. Она
 * рисуется здесь, а не в рендерере каждого типа: восемь рендереров с восемью
 * копиями подписи разъехались бы, а предпросмотр обязан показать её там же,
 * где её увидят зрители.
 */
export function WidgetStage({
  canvas,
  branding = false,
  children,
}: {
  canvas: WidgetCanvas | null | undefined;
  branding?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const size = useBoxSize(box);

  if (!canvas) {
    return (
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        {children}
        {branding ? <BrandingBadge /> : null}
      </div>
    );
  }

  // Пока место не измерено (первый кадр, тесты без ResizeObserver) — без
  // масштаба: окно просто стоит по центру в своих пикселях.
  const scale = size ? canvasScale(canvas, size) : 1;
  return (
    <div
      ref={box}
      data-testid="widget-stage"
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <div
        data-testid="widget-canvas"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: canvas.width,
          height: canvas.height,
          overflow: 'hidden',
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        {children}
        {branding ? <BrandingBadge /> : null}
      </div>
    </div>
  );
}

const BADGE_STYLE: CSSProperties = {
  position: 'absolute',
  right: 8,
  bottom: 8,
  zIndex: 2147483647,
  padding: '3px 8px',
  borderRadius: 4,
  background: 'rgba(0, 0, 0, 0.6)',
  color: '#ffffff',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.2,
  letterSpacing: '0.02em',
  pointerEvents: 'none',
  userSelect: 'none',
};

/**
 * Подпись «stream-kit.ru». Только адрес — без промокода и призывов: её видят
 * зрители чужого эфира, и она не должна спорить с виджетом за внимание.
 * Светлый текст на полупрозрачной подложке читается и на светлой сцене, и на
 * тёмной.
 */
export function BrandingBadge(): React.JSX.Element {
  return (
    <div data-testid="widget-branding" style={BADGE_STYLE}>
      stream-kit.ru
    </div>
  );
}

/** Что сейчас в кадре у виджетов, которые пусты между событиями. */
export interface StageOccupancy {
  /** Оповещение на экране, включая его уход. */
  alertShown: boolean;
  /** У «последнего события» есть событие. */
  latestEvent: boolean;
  /** Рулетка крутится или держит итог. */
  spinning: boolean;
}

/**
 * Есть ли в кадре что-то, рядом с чем уместна подпись.
 *
 * Оповещения, последнее событие без текста-заглушки и рулетка, скрытая между
 * прокрутами, большую часть эфира пусты. Подпись в пустом углу сцены висела бы
 * часами сама по себе и читалась бы как реклама поверх чужого эфира, поэтому
 * у них она появляется и уходит вместе с содержимым.
 */
export function stageHasContent(widget: WidgetConfig, occupancy: StageOccupancy): boolean {
  switch (widget.type) {
    case 'alerts':
      return occupancy.alertShown;
    case 'latest':
      return occupancy.latestEvent || widget.config.emptyText !== '';
    case 'roulette':
      return !widget.config.hideWhenIdle || occupancy.spinning;
    default:
      return true;
  }
}
