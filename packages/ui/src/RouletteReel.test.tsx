import { type RouletteSpin, rouletteWidgetConfigSchema } from '@streamkit/contracts';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reelGeometry, reelTravel, RouletteReel } from './RouletteReel';

const config = rouletteWidgetConfigSchema.parse({
  mode: 'vertical',
  resultMs: 3000,
  wheelSize: 500,
});

function spin(overrides: Partial<RouletteSpin> = {}): RouletteSpin {
  const sector = config.sectors[2]!;
  return {
    id: '00000000-0000-4000-8000-000000000002',
    sectorId: sector.id,
    sectorIndex: 2,
    label: sector.label,
    color: sector.color,
    offset: 0.5,
    turns: 5,
    source: 'manual',
    username: null,
    amount: null,
    createdAt: '2026-09-23T20:00:00.000Z',
    ...overrides,
  };
}

describe('раскладка ленты', () => {
  it('высота позиции — доля её веса, а круг не зависит от весов', () => {
    const { heights, centers, cycle } = reelGeometry([{ weight: 1 }, { weight: 3 }], 100);
    expect(heights).toEqual([50, 150]);
    expect(centers).toEqual([25, 125]);
    // Средняя позиция всегда ростом в `base`: круг — это `count × base` и с
    // двумя позициями, и со ста.
    expect(cycle).toBe(200);
  });
});

describe('путь ленты', () => {
  // Окно 500, пять видимых позиций: средняя позиция ростом в 100.
  const base = 100;

  it('лента идёт кругами, а не переезжает на победителя', () => {
    // Победитель стоит в двух позициях ниже: без целых кругов путь был бы 200,
    // то есть две строки, — именно так лента и вела себя сначала.
    const cycle = 6 * base;
    const { to, cycles } = reelTravel({
      from: 0,
      anchor: -200,
      cycle,
      base,
      turns: 5,
      maxCycles: 10,
    });
    expect(cycles).toBeGreaterThan(0);
    const travel = (0 - to) / base;
    expect(travel).toBeGreaterThanOrEqual(25);
    expect(travel).toBeLessThanOrEqual(60);
    // И встаёт ровно на победителя: путь отличается от доводки целыми кругами.
    expect((to + 200) % cycle).toBeCloseTo(0);
  });

  it('длинный список: хватает одного круга, а лишние не рисуются', () => {
    const cycle = 100 * base;
    const near = reelTravel({ from: 0, anchor: -80 * base, cycle, base, turns: 5, maxCycles: 2 });
    // Доводка сама по себе длиннее потолка — круги не нужны.
    expect(near.cycles).toBe(0);
    expect((0 - near.to) / base).toBe(80);

    const close = reelTravel({ from: 0, anchor: -2 * base, cycle, base, turns: 5, maxCycles: 2 });
    // А вот две позиции прокрутом не выглядят: добавляется круг.
    expect(close.cycles).toBe(1);
    expect((0 - close.to) / base).toBe(102);
  });

  it('когда круги не по карману, лента всё равно встаёт на победителя', () => {
    const cycle = 100 * base;
    const { to, cycles } = reelTravel({
      from: 0,
      anchor: -2 * base,
      cycle,
      base,
      turns: 5,
      maxCycles: 0,
    });
    expect(cycles).toBe(0);
    expect((0 - to) / base).toBe(2);
  });
});

describe('вертикальная рулетка', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('без анимации встаёт на выпавшую позицию, показывает итог и отдаёт очередь', () => {
    // В jsdom нет Web Animations — ровно путь «уменьшенного движения».
    const onFinished = vi.fn();
    render(<RouletteReel config={config} spin={spin()} onFinished={onFinished} />);
    act(() => vi.advanceTimersByTime(0));

    const result = screen.getByRole('status');
    expect(result.textContent).toContain(config.sectors[2]!.label);

    // Лента сдвинута так, что середина третьей позиции стоит под меткой —
    // посередине окна. Позиции равного веса, окно 500 и пять видимых: высота
    // позиции 100, середина третьей — 250 от начала круга.
    const strip = screen.getByTestId('roulette-strip');
    const shift = Number(/translateY\((-?[\d.]+)px\)/.exec(strip.style.transform)?.[1]);
    const cycle = config.sectors.length * 100;
    expect(shift + cycle + 250).toBeCloseTo(config.wheelSize / 2);

    act(() => vi.advanceTimersByTime(3000));
    expect(onFinished).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onFinished).toHaveBeenCalledWith(spin().id);
  });

  it('позиций в ленте столько, сколько в списке, и лента повторяется', () => {
    render(<RouletteReel config={config} spin={null} />);
    const strip = screen.getByTestId('roulette-strip');
    // Круги повторяются, чтобы прокрут не упёрся в край: их больше одного, и
    // каждый — полный список.
    expect(strip.children.length % config.sectors.length).toBe(0);
    expect(strip.children.length).toBeGreaterThan(config.sectors.length);
  });

  it('сотня позиций не плодит тысячи узлов', () => {
    const long = rouletteWidgetConfigSchema.parse({
      mode: 'vertical',
      sectors: Array.from({ length: 100 }, (_, index) => ({
        id: `s${index}`,
        label: `Зритель ${index + 1}`,
        weight: 1,
        color: '#A3850F',
      })),
    });
    render(<RouletteReel config={long} spin={spin({ sectorId: 's42', sectorIndex: 42 })} />);
    expect(screen.getByTestId('roulette-strip').children.length).toBeLessThanOrEqual(520);
  });

  it('подпись итога — из прокрута: позицию могли переименовать, пока лента крутилась', () => {
    render(<RouletteReel config={config} spin={spin({ label: 'Старое имя' })} />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole('status').textContent).toContain('Старое имя');
  });
});
