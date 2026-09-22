import type { WidgetCanvas } from '@streamkit/contracts';
import { type ReactNode, useRef } from 'react';
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
 */
export function WidgetStage({
  canvas,
  children,
}: {
  canvas: WidgetCanvas | null | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const size = useBoxSize(box);

  if (!canvas) {
    return <div style={{ width: '100%', height: '100%', position: 'relative' }}>{children}</div>;
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
      </div>
    </div>
  );
}
