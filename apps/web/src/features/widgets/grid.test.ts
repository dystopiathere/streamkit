import { describe, expect, it } from 'vitest';
import { GRID_STEP, snapToGrid, stepToGrid } from './grid';

/**
 * Сетка раскладки. Магнит и шаг по клеткам — это про выравнивание: два
 * элемента, поставленные по одной линии, обязаны получить одно и то же число.
 */
describe('сетка раскладки', () => {
  it('магнит ведёт к ближайшей линии', () => {
    expect(snapToGrid(26.5)).toBe(30);
    expect(snapToGrid(24.9)).toBe(20);
    expect(snapToGrid(0.4)).toBe(0);
    expect(snapToGrid(97)).toBe(100);
  });

  it('шаг приводит на линию, а не прибавляет проценты', () => {
    expect(stepToGrid(51, 1)).toBe(60);
    expect(stepToGrid(51, -1)).toBe(50);
    // Значение ровно на линии сдвигается на клетку: иначе нажатие ничего не делает.
    expect(stepToGrid(30, 1)).toBe(40);
    expect(stepToGrid(30, -1)).toBe(20);
  });

  it('дробь деления не съедает нажатие', () => {
    // 3 * 0.1 в двоичной арифметике — 0.30000000000000004, и без округления
    // шаг влево от 30 % давал бы 30 %, то есть кнопку, которая не работает.
    for (let line = 0; line <= 100; line += GRID_STEP) {
      expect(stepToGrid(line, 1)).toBe(line + GRID_STEP);
      expect(stepToGrid(line, -1)).toBe(line - GRID_STEP);
    }
  });
});
