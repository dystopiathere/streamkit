import {
  latestWidgetConfigSchema,
  type RouletteSpin,
  rouletteWidgetConfigSchema,
} from '@streamkit/contracts';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LatestEventDisplay } from './LatestEventDisplay';
import { RouletteWheel } from './RouletteWheel';
import { useRouletteQueue } from './useRouletteQueue';

const config = rouletteWidgetConfigSchema.parse({ resultMs: 3000 });

function spin(overrides: Partial<RouletteSpin> = {}): RouletteSpin {
  const sector = config.sectors[2]!;
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sectorId: sector.id,
    sectorIndex: 2,
    label: sector.label,
    color: sector.color,
    offset: 0.5,
    turns: 5,
    source: 'donation',
    username: 'Аня',
    amount: { amountMinor: 50_000, currency: 'RUB' },
    createdAt: '2026-09-22T20:00:00.000Z',
    ...overrides,
  };
}

describe('колесо рулетки', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('без анимации встаёт на выпавший сектор, показывает итог и отдаёт очередь', () => {
    // В jsdom нет Web Animations — ровно путь «уменьшенного движения».
    const onFinished = vi.fn();
    render(<RouletteWheel config={config} spin={spin()} onFinished={onFinished} />);
    act(() => vi.advanceTimersByTime(0));

    const result = screen.getByRole('status');
    expect(result.textContent).toContain(config.sectors[2]!.label);
    expect(result.textContent).toContain('Аня');
    expect(result.style.visibility).toBe('visible');

    // Середина третьего сектора из шести — 150°: колесо повёрнуто так, чтобы
    // она встала под указатель наверху.
    const rotor = screen.getByTestId('roulette-rotor');
    const angle = Number(/rotate\((-?[\d.]+)deg\)/.exec(rotor.style.transform)?.[1]);
    expect((((angle + 150) % 360) + 360) % 360).toBeCloseTo(0);

    act(() => vi.advanceTimersByTime(3000));
    expect(onFinished).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onFinished).toHaveBeenCalledWith(spin().id);
  });

  it('подпись приза — из прокрута: сектор могли переименовать, пока колесо крутилось', () => {
    render(<RouletteWheel config={config} spin={spin({ label: 'Старое имя' })} />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole('status').textContent).toContain('Старое имя');
  });

  it('прокрут кнопкой — без имени донатера', () => {
    render(
      <RouletteWheel
        config={config}
        spin={spin({ source: 'manual', username: null, amount: null })}
      />,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole('status').textContent).not.toContain('Аня');
  });

  it('в покое итог скрыт, но место за ним держится', () => {
    render(<RouletteWheel config={config} spin={null} />);
    expect(screen.getByRole('status', { hidden: true }).style.visibility).toBe('hidden');
  });

  it('подписи секторов цветом, контрастным сектору', () => {
    const light = rouletteWidgetConfigSchema.parse({
      sectors: [
        { id: 'a', label: 'Светлый', weight: 1, color: '#F5D336' },
        { id: 'b', label: 'Тёмный', weight: 1, color: '#1A1A1A' },
      ],
    });
    render(<RouletteWheel config={light} spin={null} />);
    expect(screen.getByText('Светлый').getAttribute('fill')).toBe('#100F0D');
    expect(screen.getByText('Тёмный').getAttribute('fill')).toBe('#FFFFFF');
  });
});

describe('очередь прокрутов', () => {
  it('по одному, без дублей от переподключения', () => {
    const { result } = renderHook(() => useRouletteQueue());
    const first = spin();
    const second = spin({ id: '00000000-0000-4000-8000-000000000002' });
    act(() => {
      result.current.enqueue(first);
      result.current.enqueue(first);
      result.current.enqueue(second);
    });
    expect(result.current.current?.id).toBe(first.id);
    act(() => result.current.finish(first.id));
    expect(result.current.current?.id).toBe(second.id);
    act(() => result.current.finish(second.id));
    expect(result.current.current).toBeNull();
  });
});

describe('последнее событие', () => {
  const latest = latestWidgetConfigSchema.parse({});

  it('подставляет событие в шаблон', () => {
    render(
      <LatestEventDisplay
        config={latest}
        state={{
          kind: 'latest',
          event: {
            type: 'donation',
            username: 'Кирилл',
            message: '',
            amount: { amountMinor: 100_000, currency: 'RUB' },
            count: null,
            createdAt: '2026-09-22T20:00:00.000Z',
          },
        }}
      />,
    );
    const value = screen.getByTestId('latest-event').querySelector('[data-slot="value"]');
    expect(value?.textContent).toMatch(/^Кирилл — 1\s000\s₽$/);
  });

  it('без событий и без текста на этот случай в кадре пусто', () => {
    const { container } = render(
      <LatestEventDisplay config={latest} state={{ kind: 'latest', event: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('без событий показывает заданный текст', () => {
    render(
      <LatestEventDisplay
        config={{ ...latest, emptyText: 'Будь первым' }}
        state={{ kind: 'latest', event: null }}
      />,
    );
    expect(screen.getByText('Будь первым')).toBeTruthy();
  });
});
