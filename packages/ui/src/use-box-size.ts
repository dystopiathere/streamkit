import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * Размер элемента, пока он на странице. null — ещё не измерен или браузер не
 * умеет `ResizeObserver` (тесты в jsdom): тогда сетка работает долями.
 */
export function useBoxSize(
  ref: RefObject<HTMLElement | null>,
): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        previous && previous.width === width && previous.height === height
          ? previous
          : width > 0 && height > 0
            ? { width, height }
            : null,
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  });
  return size;
}
