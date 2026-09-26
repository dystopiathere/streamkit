import { render, screen } from '@testing-library/react';
import type { StreamChat } from '@streamkit/contracts';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { ChatPanel } from './ChatPanel';

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

const TWITCH: StreamChat = {
  platform: 'twitch',
  channel: 'streamer',
  title: 'Streamer',
  state: 'ok',
};
const KICK: StreamChat = { platform: 'kick', channel: 'streamer', title: 'streamer', state: 'ok' };
const YOUTUBE: StreamChat = {
  platform: 'youtube',
  channel: 'UC1',
  title: 'Канал',
  state: 'waiting',
};

function renderPanel(chats: StreamChat[]): void {
  render(
    <MemoryRouter>
      <ChatPanel chats={chats} messages={[]} />
    </MemoryRouter>,
  );
}

describe('шапка чата в окне эфира', () => {
  it('один читаемый чат — «Читается чат» и значок', () => {
    renderPanel([TWITCH]);
    expect(screen.getByText('Читается чат')).toBeTruthy();
    expect(screen.getByTitle('twitch.tv/streamer')).toBeTruthy();
  });

  it('несколько — «Читаются чаты:» со значками, нечитаемый — строкой с причиной', () => {
    renderPanel([TWITCH, KICK, YOUTUBE]);
    expect(screen.getByText('Читаются чаты:')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Kick' })).toBeTruthy();
    expect(screen.getByText('Канал — ждём начала эфира')).toBeTruthy();
    expect(screen.queryByText(/читаем чат/)).toBeNull();
  });

  it('ни один не читается — без «Читается»', () => {
    renderPanel([YOUTUBE]);
    expect(screen.queryByText(/Читает/)).toBeNull();
  });
});
