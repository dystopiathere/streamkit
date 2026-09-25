import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Channel, Platform } from '@streamkit/contracts';
import i18n from '@/lib/i18n';
import { SyncNotice } from './SyncNotice';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

function channel(platform: Platform): Channel {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    platform,
    externalId: '1',
    login: 'streamer',
    displayName: 'Стример',
    avatarUrl: null,
    connectedAt: '2026-09-25T00:00:00.000Z',
    lastSyncedAt: null,
    isEnabled: true,
    syncState: 'ok',
    needsReconnect: true,
  };
}

function renderNotice(platform: Platform): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SyncNotice channel={channel(platform)} />
    </QueryClientProvider>,
  );
}

describe('SyncNotice', () => {
  it('просьба переподключиться называет площадку своей карточки', () => {
    renderNotice('kick');
    const text = screen.getByRole('alert').textContent;
    expect(text).toContain('Переподключите Kick');
    expect(text).not.toContain('Twitch');
  });

  it('у Twitch — про биты и награды за баллы', () => {
    renderNotice('twitch');
    expect(screen.getByRole('alert').textContent).toContain('Переподключите Twitch');
  });
});
