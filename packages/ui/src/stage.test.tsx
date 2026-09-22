import { defaultAlertWidgetConfig } from '@streamkit/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertCard } from './AlertCard';
import { canvasScale, WidgetStage } from './stage';

describe('окно виджета', () => {
  it('рисует содержимое ровно в пикселях окна', () => {
    render(
      <WidgetStage canvas={{ width: 800, height: 600 }}>
        <span>кадр</span>
      </WidgetStage>,
    );
    const canvas = screen.getByTestId('widget-canvas');
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });

  it('масштаб — по меньшей стороне: окно целиком, без искажения пропорций', () => {
    // Сорс 1920 × 1080 и окно 800 × 600: по высоте 1,8, по ширине 2,4 — берём 1,8.
    expect(canvasScale({ width: 800, height: 600 }, { width: 1920, height: 1080 })).toBeCloseTo(
      1.8,
    );
    expect(canvasScale({ width: 800, height: 600 }, { width: 400, height: 600 })).toBeCloseTo(0.5);
  });

  it('без окна содержимое растягивается на всё место, как раньше', () => {
    render(
      <WidgetStage canvas={null}>
        <span>кадр</span>
      </WidgetStage>,
    );
    expect(screen.queryByTestId('widget-canvas')).toBeNull();
    expect(screen.getByText('кадр')).toBeDefined();
  });
});

describe('ширина картинки оповещения', () => {
  const event = {
    type: 'donation' as const,
    username: 'Зритель',
    message: '',
    amount: null,
    count: null,
  };

  it('своя ширина из раскладки — высота по пропорциям картинки', () => {
    const scenario = defaultAlertWidgetConfig().scenarios.donation;
    const config = {
      ...scenario,
      imageUrl: 'https://cdn.example/a.png',
      slots: { ...scenario.slots, image: { ...scenario.slots.image, width: 480 } },
    };
    const { container } = render(<AlertCard event={event} config={config} animate={false} />);
    const image = container.querySelector('img')!;
    expect(image.style.width).toBe('480px');
    expect(image.style.height).toBe('auto');
    expect(image.style.maxWidth).toBe('');
  });

  it('без своей ширины — прежнее «не больше 320 × 240»', () => {
    const config = {
      ...defaultAlertWidgetConfig().scenarios.donation,
      imageUrl: 'https://cdn.example/a.png',
    };
    const { container } = render(<AlertCard event={event} config={config} animate={false} />);
    expect(container.querySelector('img')!.style.maxWidth).toBe('320px');
  });
});
