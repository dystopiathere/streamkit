import { describe, expect, it } from 'vitest';
import { pageWindow } from './data';

describe('номера страниц', () => {
  it('до семи страниц — все подряд', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('дальше — первая, последняя, соседи текущей и разрывы', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 19, 20]);
    // Разрыв на одну страницу не рисуется: вторая стоит рядом с первой.
    expect(pageWindow(3, 20)).toEqual([1, 2, 3, 4, null, 20]);
  });
});
