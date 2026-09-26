import {
  alertWidgetConfigSchema,
  defaultAlertWidgetConfig,
  goalWidgetConfigSchema,
  latestWidgetConfigSchema,
  rouletteWidgetConfigSchema,
  type WidgetConfig,
} from '@streamkit/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertCard } from './AlertCard';
import { canvasScale, stageHasContent, WidgetStage } from './stage';

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

describe('подпись бесплатного тарифа', () => {
  it('стоит в окне виджета, когда её просит тариф, и только тогда', () => {
    const { rerender } = render(
      <WidgetStage canvas={{ width: 800, height: 600 }} branding>
        <span>виджет</span>
      </WidgetStage>,
    );
    const badge = screen.getByTestId('widget-branding');
    expect(badge.textContent).toBe('stream-kit.ru');
    // Внутри окна, а не поверх всего места: масштабируется вместе с виджетом.
    expect(screen.getByTestId('widget-canvas').contains(badge)).toBe(true);

    rerender(
      <WidgetStage canvas={{ width: 800, height: 600 }}>
        <span>виджет</span>
      </WidgetStage>,
    );
    expect(screen.queryByTestId('widget-branding')).toBeNull();
  });

  it('есть и у виджета без окна', () => {
    render(
      <WidgetStage canvas={null} branding>
        <span>виджет</span>
      </WidgetStage>,
    );
    expect(screen.getByTestId('widget-branding')).toBeTruthy();
  });
});

describe('подпись у виджетов, пустых между событиями', () => {
  const idle = { alertShown: false, latestEvent: false, spinning: false };
  const alerts: WidgetConfig = { type: 'alerts', config: alertWidgetConfigSchema.parse({}) };
  const latest: WidgetConfig = { type: 'latest', config: latestWidgetConfigSchema.parse({}) };
  const hiddenWheel: WidgetConfig = {
    type: 'roulette',
    config: rouletteWidgetConfigSchema.parse({ hideWhenIdle: true }),
  };

  it('у оповещений — только пока оповещение на экране', () => {
    expect(stageHasContent(alerts, idle)).toBe(false);
    expect(stageHasContent(alerts, { ...idle, alertShown: true })).toBe(true);
  });

  it('у последнего события — с событием или с текстом на пустой случай', () => {
    expect(stageHasContent(latest, idle)).toBe(false);
    expect(stageHasContent(latest, { ...idle, latestEvent: true })).toBe(true);
    const withText: WidgetConfig = {
      type: 'latest',
      config: latestWidgetConfigSchema.parse({ emptyText: 'Ждём первого' }),
    };
    expect(stageHasContent(withText, idle)).toBe(true);
  });

  it('у рулетки, скрытой между прокрутами, — только на прокрут', () => {
    expect(stageHasContent(hiddenWheel, idle)).toBe(false);
    expect(stageHasContent(hiddenWheel, { ...idle, spinning: true })).toBe(true);
    const wheel: WidgetConfig = { type: 'roulette', config: rouletteWidgetConfigSchema.parse({}) };
    expect(stageHasContent(wheel, idle)).toBe(true);
  });

  it('у остальных — всегда', () => {
    const goal: WidgetConfig = { type: 'goal', config: goalWidgetConfigSchema.parse({}) };
    expect(stageHasContent(goal, idle)).toBe(true);
  });
});
