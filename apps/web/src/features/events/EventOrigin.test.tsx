import { render, screen } from '@testing-library/react';
import { EVENT_PROVIDERS } from '@streamkit/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { EventOrigin } from './EventOrigin';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

/**
 * Строка ленты раньше была одним ником: фолловер Kick не отличался от доната,
 * и не было видно, на какой площадке он случился.
 */
describe('происхождение события в ленте', () => {
  it('фолловер Kick — тип, площадка и значок', () => {
    render(<EventOrigin event={{ type: 'follow', provider: 'kick' }} />);
    expect(screen.getByText('Фолловер · Kick')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Kick' })).toBeTruthy();
  });

  it('донат из сервиса — тип и название сервиса без значка', () => {
    render(<EventOrigin event={{ type: 'donation', provider: 'donationalerts' }} />);
    expect(screen.getByText('Донат · DonationAlerts')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('тестовый алерт из кабинета — только тип', () => {
    render(<EventOrigin event={{ type: 'raid', provider: 'manual' }} />);
    expect(screen.getByText('Рейд')).toBeTruthy();
  });

  it('у каждого источника, кроме тестового, есть название', () => {
    for (const provider of EVENT_PROVIDERS.filter((value) => value !== 'manual')) {
      const { container, unmount } = render(
        <EventOrigin event={{ type: 'subscription', provider }} />,
      );
      expect(container.textContent).toMatch(/Подписка · \S+$/);
      unmount();
    }
  });

  it('по-английски — те же части', async () => {
    await i18n.changeLanguage('en');
    render(<EventOrigin event={{ type: 'follow', provider: 'twitch' }} />);
    expect(screen.getByText('Follower · Twitch')).toBeTruthy();
    await i18n.changeLanguage('ru');
  });
});
