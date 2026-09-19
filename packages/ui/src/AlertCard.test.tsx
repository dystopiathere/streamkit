import { defaultAlertWidgetConfig } from '@streamkit/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertCard } from './AlertCard';

const baseEvent = {
  username: 'Вася',
  message: 'Привет стриму!',
  amount: { amountMinor: 50_000, currency: 'RUB' as const },
  count: null,
  type: 'donation' as const,
};

/** Сценарий доната по умолчанию — карточка рендерит сценарий, а не весь виджет. */
const donation = () => defaultAlertWidgetConfig().scenarios.donation;

describe('AlertCard', () => {
  it('показывает имя донатера и сообщение', () => {
    render(<AlertCard event={baseEvent} config={donation()} />);

    expect(screen.getByText('Вася')).toBeDefined();
    expect(screen.getByText('Привет стриму!')).toBeDefined();
  });

  it('не выводит блок сообщения, если сообщения нет', () => {
    render(<AlertCard event={{ ...baseEvent, message: '   ' }} config={donation()} />);

    expect(screen.queryByText('Привет стриму!')).toBeNull();
  });

  it('не исполняет HTML из ника — он остаётся текстом', () => {
    const { container } = render(
      <AlertCard
        event={{ ...baseEvent, username: '<img src=x onerror=alert(1)>' }}
        config={donation()}
      />,
    );

    // Единственный <img> в разметке мог бы появиться только из ника: в конфиге
    // картинка не задана. Значит ник отрисован как текст, а не как HTML.
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeDefined();
  });

  it('оставляет неизвестный плейсхолдер видимым, чтобы опечатка бросалась в глаза', () => {
    const config = donation();
    render(
      <AlertCard event={baseEvent} config={{ ...config, titleTemplate: 'Дар от {nickname}' }} />,
    );

    expect(screen.getByText('{nickname}')).toBeDefined();
  });

  it('подставляет отформатированную сумму', () => {
    const config = donation();
    const { container } = render(
      <AlertCard event={baseEvent} config={{ ...config, titleTemplate: '{amount}' }} />,
    );

    expect(container.textContent).toContain('500');
  });

  it('рендерит картинку из конфига, когда она задана', () => {
    const config = donation();
    const { container } = render(
      <AlertCard
        event={baseEvent}
        config={{ ...config, imageUrl: 'https://cdn.example.com/a.gif' }}
      />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/a.gif',
    );
  });

  it('подставляет количество с разрядами — биты, зрители рейда', () => {
    render(
      <AlertCard
        event={{ ...baseEvent, type: 'cheer', amount: null, count: 10_000 }}
        config={defaultAlertWidgetConfig().scenarios.cheer}
      />,
    );
    expect(screen.getByText(/10\s000/)).toBeTruthy();
  });
});
