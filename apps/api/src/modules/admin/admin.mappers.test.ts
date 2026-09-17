import { describe, expect, it } from 'vitest';
import { monthlyRecurringMinor } from './admin-stats.service';
import { escapeLike, pageArgs, toPage } from './admin.mappers';

const BACKSLASH = String.fromCharCode(92);

describe('вспомогательное админки', () => {
  it('символы шаблона LIKE в поиске — обычные символы', () => {
    expect(escapeLike('a_b%c')).toBe(`a${BACKSLASH}_b${BACKSLASH}%c`);
    expect(escapeLike(`x${BACKSLASH}y`)).toBe(`x${BACKSLASH}${BACKSLASH}y`);
    expect(escapeLike('обычный текст')).toBe('обычный текст');
  });

  it('страница берёт на одну запись больше и отдаёт курсор последней показанной', () => {
    expect(pageArgs(2, undefined)).toMatchObject({ take: 3 });
    expect(pageArgs(2, 'id-9')).toMatchObject({ cursor: { id: 'id-9' }, skip: 1 });

    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(toPage(rows, 2)).toEqual({ rows: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' });
    expect(toPage(rows.slice(0, 2), 2)).toEqual({ rows: rows.slice(0, 2), nextCursor: null });
  });

  it('месячная выручка годовой подписки — целое число копеек, остаток отбрасывается', () => {
    expect(monthlyRecurringMinor('month', 49_000)).toBe(49_000);
    expect(monthlyRecurringMinor('year', 490_000)).toBe(40_833);
    expect(Number.isInteger(monthlyRecurringMinor('year', 100_001))).toBe(true);
  });
});
