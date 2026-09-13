import { type ChatMessage, chatWidgetConfigSchema } from '@streamkit/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatBox } from './ChatBox';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    platform: 'twitch',
    channel: 'example',
    login: 'viewer',
    username: 'Зритель',
    color: '#7FD1B9',
    badges: [],
    parts: [{ kind: 'text', value: 'привет' }],
    sentAt: new Date().toISOString(),
    ...overrides,
  };
}

const config = (overrides: Record<string, unknown> = {}) =>
  chatWidgetConfigSchema.parse({ channel: 'example', ...overrides });

describe('ChatBox', () => {
  it('показывает ник и текст', () => {
    render(<ChatBox config={config()} messages={[message()]} />);

    expect(screen.getByText('Зритель')).toBeDefined();
    expect(screen.getByText('привет')).toBeDefined();
  });

  it('пустая лента не занимает места в кадре', () => {
    // Надпись «пока никого» поверх эфира не нужна никому: виджет просто не
    // рисуется, пока чат молчит.
    const { container } = render(<ChatBox config={config()} messages={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('прячет ботов из списка', () => {
    render(
      <ChatBox
        config={config({ hiddenUsers: ['nightbot'] })}
        messages={[message({ login: 'nightbot', username: 'Nightbot' })]}
      />,
    );
    expect(screen.queryByText('Nightbot')).toBeNull();
  });

  it('прячет команды ботов, но только если просили', () => {
    const command = message({ parts: [{ kind: 'text', value: '!розыгрыш' }] });

    const { unmount } = render(<ChatBox config={config()} messages={[command]} />);
    expect(screen.queryByText('!розыгрыш')).toBeNull();
    unmount();

    render(<ChatBox config={config({ hideCommands: false })} messages={[command]} />);
    expect(screen.getByText('!розыгрыш')).toBeDefined();
  });

  it('держит на экране не больше, чем просили', () => {
    const messages = Array.from({ length: 5 }, (_, index) =>
      message({ parts: [{ kind: 'text', value: `строка ${index}` }] }),
    );

    render(<ChatBox config={config({ maxMessages: 2 })} messages={messages} />);

    // Остаются последние: чат читают снизу, а не сначала.
    expect(screen.queryByText('строка 2')).toBeNull();
    expect(screen.getByText('строка 3')).toBeDefined();
    expect(screen.getByText('строка 4')).toBeDefined();
  });

  it('эмоут рисуется картинкой с подписью', () => {
    // Подпись обязательна: в браузер-сорсе OBS картинка может не догрузиться, и
    // пустое место посреди фразы хуже, чем слово «Kappa».
    render(
      <ChatBox
        config={config()}
        messages={[message({ parts: [{ kind: 'emote', id: '25', alt: 'Kappa' }] })]}
      />,
    );

    const emote = screen.getByAltText('Kappa') as HTMLImageElement;
    expect(emote.src).toContain('/emoticons/v2/25/');
  });

  it('с выключенными эмоутами показывает их код текстом', () => {
    render(
      <ChatBox
        config={config({ showEmotes: false })}
        messages={[message({ parts: [{ kind: 'emote', id: '25', alt: 'Kappa' }] })]}
      />,
    );

    expect(screen.queryByAltText('Kappa')).toBeNull();
    expect(screen.getByText('Kappa')).toBeDefined();
  });

  it('гасит сообщения старше заданного срока', () => {
    const old = message({
      parts: [{ kind: 'text', value: 'старое' }],
      sentAt: new Date(Date.now() - 120_000).toISOString(),
    });
    const fresh = message({ parts: [{ kind: 'text', value: 'свежее' }] });

    render(<ChatBox config={config({ messageLifetimeSeconds: 30 })} messages={[old, fresh]} />);

    expect(screen.queryByText('старое')).toBeNull();
    expect(screen.getByText('свежее')).toBeDefined();
  });

  it('с нулевым сроком не гасит ничего', () => {
    const ancient = message({
      parts: [{ kind: 'text', value: 'вчерашнее' }],
      sentAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    render(<ChatBox config={config({ messageLifetimeSeconds: 0 })} messages={[ancient]} />);
    expect(screen.getByText('вчерашнее')).toBeDefined();
  });
});
