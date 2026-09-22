import { describe, expect, it } from 'vitest';
import { overflows, searchScale } from './WidgetPreview';

/** Узел с заданным прямоугольником: jsdom раскладку не считает. */
function node(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
    }) as DOMRect;
  return element;
}

const frame = () => node({ left: 0, top: 0, width: 400, height: 225 });

describe('масштаб предпросмотра', () => {
  it('корень во весь кадр с дробным краем не считается вылезшим', () => {
    // Раньше лишние сотые пикселя уменьшали масштаб, и он залипал.
    const content = node({ left: 0, top: 0, width: 400, height: 225 });
    content.append(node({ left: -0.02, top: -0.01, width: 400.04, height: 225.02 }));
    expect(overflows(frame(), content)).toBe(false);
  });

  it('элемент кадра за краем — вылезает', () => {
    const content = node({ left: 0, top: 0, width: 400, height: 225 });
    const root = node({ left: 0, top: 0, width: 400, height: 225 });
    const slot = node({ left: 380, top: 20, width: 60, height: 20 });
    slot.dataset.slot = 'title';
    root.append(slot);
    content.append(root);
    expect(overflows(frame(), content)).toBe(true);
  });

  it('ищет самый крупный масштаб, при котором всё влезает', () => {
    // Элемент 600 px в кадре 400 px: при масштабе s он виден шириной 600·s.
    const scale = searchScale((s) => 600 * s > 400);
    expect(scale).toBeLessThanOrEqual(400 / 600);
    expect(scale).toBeGreaterThan(400 / 600 - 0.02);
  });

  it('когда сцена снова помещается, масштаб — 100 %', () => {
    // Поиск каждый раз начинается с полного размера, а не с прошлого масштаба.
    expect(searchScale(() => false)).toBe(1);
  });
});
