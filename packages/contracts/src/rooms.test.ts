import { describe, expect, it } from 'vitest';
import {
  guestIdentity,
  guestJoinSchema,
  hostIdentity,
  layoutTiles,
  overlayIdentity,
  parseParticipantIdentity,
} from './rooms.js';
import { defaultWidgetConfig, guestsWidgetConfigSchema, hasWidgetState } from './widgets.js';

const USER = '00000000-0000-4000-8000-000000000001';
const INVITE = '00000000-0000-4000-8000-000000000002';

describe('раскладка плиток гостей', () => {
  it('один гость занимает весь кадр', () => {
    expect(layoutTiles(1, 'grid')).toEqual({ columns: 2, rows: 1, tiles: [{ column: 1, row: 1 }] });
  });

  it('четверо встают квадратом два на два', () => {
    const grid = layoutTiles(4, 'grid');
    expect(grid.columns).toBe(4);
    expect(grid.rows).toBe(2);
    expect(grid.tiles.map((tile) => tile.row)).toEqual([1, 1, 2, 2]);
  });

  it('неполный последний ряд встаёт по центру, а не к левому краю', () => {
    // Пятеро: 3 + 2. Нижний ряд сдвинут на полплитки — колонка 2, а не 1.
    const grid = layoutTiles(5, 'grid');
    expect(grid.columns).toBe(6);
    expect(grid.tiles.slice(3)).toEqual([
      { column: 2, row: 2 },
      { column: 4, row: 2 },
    ]);
  });

  it('ряд и колонка раскладывают в одну линию', () => {
    expect(layoutTiles(3, 'row')).toMatchObject({ columns: 6, rows: 1 });
    expect(layoutTiles(3, 'column')).toMatchObject({ columns: 2, rows: 3 });
    expect(layoutTiles(3, 'column').tiles.every((tile) => tile.column === 1)).toBe(true);
  });

  it('без гостей плиток нет', () => {
    expect(layoutTiles(0, 'grid').tiles).toEqual([]);
  });
});

describe('идентичность участника', () => {
  it('роль читается из префикса, который ставит сервер', () => {
    expect(parseParticipantIdentity(hostIdentity(USER))).toEqual({ role: 'host', id: USER });
    expect(parseParticipantIdentity(overlayIdentity(USER))).toEqual({ role: 'overlay', id: USER });
    expect(parseParticipantIdentity(guestIdentity(INVITE, 'a1B2_c'))).toEqual({
      role: 'guest',
      id: INVITE,
    });
  });

  it('чужой формат не принимается за гостя', () => {
    // Оверлей рендерит только гостей: всё непонятное обязано отсеяться, а не
    // превратиться в роль по умолчанию.
    expect(parseParticipantIdentity('guest:not-a-uuid:x')).toBeNull();
    expect(parseParticipantIdentity(`admin:${USER}`)).toBeNull();
    expect(parseParticipantIdentity(`host:${USER}:extra`)).toBeNull();
    expect(parseParticipantIdentity('')).toBeNull();
  });
});

describe('вход гостя', () => {
  it('без согласия запрос отвергается схемой', () => {
    const base = { token: 'abc', displayName: 'Вася' };
    expect(guestJoinSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
    expect(guestJoinSchema.safeParse(base).success).toBe(false);
    expect(guestJoinSchema.safeParse({ ...base, acceptTerms: true }).success).toBe(true);
  });

  it('имя из одних пробелов не проходит', () => {
    expect(
      guestJoinSchema.safeParse({ token: 'abc', displayName: '   ', acceptTerms: true }).success,
    ).toBe(false);
  });
});

describe('виджет гостей', () => {
  it('создаётся без комнаты и без состояния', () => {
    const widget = defaultWidgetConfig('guests');
    expect(widget.type).toBe('guests');
    expect(widget.config).toMatchObject({ roomId: '', layout: 'grid', maxTiles: 4 });
    expect(hasWidgetState('guests')).toBe(false);
  });

  it('не принимает произвольную строку вместо идентификатора комнаты', () => {
    expect(guestsWidgetConfigSchema.safeParse({ roomId: '../rooms' }).success).toBe(false);
    expect(guestsWidgetConfigSchema.safeParse({ roomId: USER }).success).toBe(true);
  });
});
