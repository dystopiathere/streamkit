import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_ENTER_DURATION_MS, ALERT_EXIT_DURATION_MS } from '@streamkit/ui';
import { defaultWidgetConfig } from '@streamkit/contracts';
import { WidgetPreview } from './WidgetPreview';
import i18n from '@/lib/i18n';

/**
 * Анимация в предпросмотре.
 *
 * Карточка стоит неподвижно, пока правят шаблон или цвет: предпросмотр
 * перерисовывается на каждое нажатие клавиши, и анимация при каждом из них
 * превратила бы его в мигалку. Смена самой анимации проигрывает её один раз —
 * выбрать анимацию, ни разу её не увидев, нельзя.
 */
beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function config(animationIn: string, animationOut = 'fade'): Record<string, unknown> {
  const base = defaultWidgetConfig('alerts').config as {
    scenarios: Record<string, Record<string, unknown>>;
  };
  return {
    ...base,
    scenarios: {
      ...base.scenarios,
      donation: { ...base.scenarios.donation, animationIn, animationOut },
    },
  } as unknown as Record<string, unknown>;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function preview(values: Record<string, unknown>): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <WidgetPreview type="alerts" config={values} state={null} alertScenario="donation" />
    </QueryClientProvider>
  );
}

const card = (): HTMLElement => screen.getByTestId('alert-card');
const stage = (): HTMLElement => card().parentElement!;

describe('анимация в предпросмотре', () => {
  it('на открытии не играет, на смене появления — проигрывает его один раз', () => {
    const { rerender } = render(preview(config('slide-up')));
    expect(card().style.animation).toBe('');

    rerender(preview(config('bounce')));
    expect(card().style.animation).toContain('sk-bounce');

    // Доиграла — карточка снова неподвижна, и правка текста её не дёргает.
    act(() => vi.advanceTimersByTime(ALERT_ENTER_DURATION_MS));
    expect(card().style.animation).toBe('');
  });

  it('смена ухода показывает уход и возвращает карточку', () => {
    const { rerender } = render(preview(config('slide-up', 'fade')));
    rerender(preview(config('slide-up', 'zoom')));

    expect(stage().style.animation).toContain('sk-out-zoom');
    // Уход оставляет карточку невидимой: без возврата предпросмотр опустел бы.
    act(() => vi.advanceTimersByTime(ALERT_EXIT_DURATION_MS));
    expect(stage().style.animation).toBe('');
    expect(card().style.animation).toBe('');
  });

  it('правка, не трогающая анимацию, ничего не проигрывает', () => {
    const { rerender } = render(preview(config('slide-up')));
    const values = config('slide-up');
    const scenarios = values.scenarios as Record<string, Record<string, unknown>>;
    scenarios.donation = { ...scenarios.donation, titleTemplate: 'другое' };
    rerender(preview(values));
    expect(card().style.animation).toBe('');
    expect(stage().style.animation).toBe('');
  });
});
