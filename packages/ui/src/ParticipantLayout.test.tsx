import { guestsWidgetConfigSchema } from '@streamkit/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type ParticipantTile, ParticipantLayout } from './ParticipantLayout';

const config = (overrides: Record<string, unknown> = {}) =>
  guestsWidgetConfigSchema.parse(overrides);

function tile(name: string, hasVideo = true): ParticipantTile {
  return { id: name, name, hasVideo, media: <video data-testid={`video-${name}`} /> };
}

describe('ParticipantLayout', () => {
  it('рисует плитку на каждого гостя с именем', () => {
    render(<ParticipantLayout config={config()} tiles={[tile('Вася'), tile('Петя')]} />);

    expect(screen.getAllByTestId('participant-tile')).toHaveLength(2);
    expect(screen.getByText('Вася')).toBeDefined();
    expect(screen.getByTestId('video-Петя')).toBeDefined();
  });

  it('без гостей ничего не рисует', () => {
    // Пустая рамка «ждём гостей» поверх эфира не нужна: виджет просто пропадает.
    const { container } = render(<ParticipantLayout config={config()} tiles={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('не показывает больше плиток, чем разрешено', () => {
    const tiles = ['1', '2', '3', '4', '5'].map((name) => tile(name));
    render(<ParticipantLayout config={config({ maxTiles: 3 })} tiles={tiles} />);
    expect(screen.getAllByTestId('participant-tile')).toHaveLength(3);
  });

  it('гость без камеры остаётся в кадре именем', () => {
    render(<ParticipantLayout config={config()} tiles={[tile('Вася', false)]} />);
    expect(screen.getByText('Вася')).toBeDefined();
    expect(screen.queryByTestId('video-Вася')).toBeNull();
  });

  it('гостя без камеры можно убрать из кадра', () => {
    const { container } = render(
      <ParticipantLayout
        config={config({ showWithoutVideo: false })}
        tiles={[tile('Вася', false)]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('имя под видео можно скрыть, а без видео — нельзя', () => {
    // Плитка без видео и без имени — пустой тёмный прямоугольник в кадре.
    render(
      <ParticipantLayout
        config={config({ showNames: false })}
        tiles={[tile('Вася'), tile('Петя', false)]}
      />,
    );
    expect(screen.queryByText('Вася')).toBeNull();
    expect(screen.getByText('Петя')).toBeDefined();
  });
});
