import {
  defaultWidgetConfig,
  type GoalWidgetConfig,
  goalWidgetConfigSchema,
} from '@streamkit/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GoalBar } from './GoalBar';
import { isPositioned, slotCss } from './slots';

const goalConfig = (overrides: Record<string, unknown> = {}): GoalWidgetConfig =>
  goalWidgetConfigSchema.parse(overrides);

describe('позиции элементов', () => {
  it('без позиции стилей позиционирования нет — элемент остаётся в потоке', () => {
    const style = slotCss({ x: null, y: null, color: null, fontSize: null }, 32);
    expect(style.position).toBeUndefined();
    expect(style.fontSize).toBe(32);
    expect(style.color).toBeUndefined();
  });

  it('заданная позиция — проценты и перенос на половину размера', () => {
    const style = slotCss({ x: 25, y: 80, color: '#FF0000', fontSize: 48 }, 32);
    expect(style.position).toBe('absolute');
    expect(style.left).toBe('25%');
    expect(style.top).toBe('80%');
    expect(style.transform).toBe('translate(-50%, -50%)');
    expect(style.fontSize).toBe(48);
    expect(style.color).toBe('#FF0000');
  });

  it('половина позиции позицией не считается: элемент не должен уехать в угол', () => {
    expect(isPositioned({ x: 10, y: null, color: null, fontSize: null })).toBe(false);
    expect(isPositioned({ x: null, y: 10, color: null, fontSize: null })).toBe(false);
    expect(isPositioned(undefined)).toBe(false);
    expect(isPositioned({ x: 0, y: 0, color: null, fontSize: null })).toBe(true);
  });
});

describe('фон виджета', () => {
  it('без цвета и картинки слоя нет — кадр остаётся прозрачным', () => {
    render(<GoalBar config={goalConfig()} state={null} />);
    expect(screen.queryByTestId('widget-background')).toBeNull();
  });

  it('картинка фона идёт без Referer: адрес оверлея несёт токен', () => {
    render(
      <GoalBar
        config={goalConfig({ background: { imageUrl: 'https://example.com/bg.png' } })}
        state={null}
      />,
    );
    const image = screen.getByTestId('widget-background').querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('кавычка в адресе плитки экранируется, а не закрывает строку CSS', () => {
    const url = 'https://example.com/a".png';
    render(
      <GoalBar config={goalConfig({ background: { imageUrl: url, fit: 'tile' } })} state={null} />,
    );
    const tile = screen.getByTestId('widget-background').querySelector('div');
    expect(tile?.style.backgroundImage).toContain('\\"');
  });
});

describe('полоса цели', () => {
  it('заполнение обрезается по прогрессу, а не сжимается', () => {
    render(
      <GoalBar
        config={goalConfig({ targetMinor: 100_000 })}
        state={{
          kind: 'goal',
          raisedMinor: 25_000,
          targetMinor: 100_000,
          currency: 'RUB',
          offsetMinor: 0,
        }}
      />,
    );
    const fill = screen.getByRole('progressbar').querySelector('div');
    // Четверть собрана — отрезано три четверти справа.
    expect(fill?.style.clipPath).toBe('inset(0 75% 0 0)');
  });

  it('картинка вместо полосы рисуется во всю ширину: режет её обрезка', () => {
    render(
      <GoalBar
        config={goalConfig({
          barImageUrl: 'https://example.com/bar.png',
          trackImageUrl: 'https://example.com/track.png',
        })}
        state={null}
      />,
    );
    const images = screen.getByRole('progressbar').querySelectorAll('img');
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.style.width).toBe('100%');
      expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    }
  });

  it('конфиг по умолчанию рисует полосу цветом, без картинок', () => {
    const { config } = defaultWidgetConfig('goal');
    render(<GoalBar config={config as GoalWidgetConfig} state={null} />);
    expect(screen.getByRole('progressbar').querySelectorAll('img')).toHaveLength(0);
  });
});
