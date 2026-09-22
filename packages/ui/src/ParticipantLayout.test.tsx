import { guestsWidgetConfigSchema } from '@streamkit/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fitTile, type ParticipantTile, ParticipantLayout } from './ParticipantLayout';

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

  it('свободная раскладка ставит гостя в его место — от середины, плиткой 16:9', () => {
    render(
      <ParticipantLayout
        config={config({
          layout: 'free',
          seats: [
            { x: 20, y: 30, width: 25 },
            { x: 80, y: 70, width: 30 },
          ],
        })}
        tiles={[tile('Вася'), tile('Петя')]}
      />,
    );
    const [first, second] = screen.getAllByTestId('participant-tile') as HTMLElement[];
    expect(first!.style.left).toBe('20%');
    expect(first!.style.top).toBe('30%');
    expect(first!.style.width).toBe('25%');
    expect(first!.style.aspectRatio).not.toBe('');
    expect(first!.style.transform).toBe('translate(-50%, -50%)');
    expect(second!.style.left).toBe('80%');
  });

  it('гостю без своего места достаётся место по умолчанию', () => {
    // Мест в конфиге меньше, чем гостей: третий не должен пропасть из кадра.
    render(
      <ParticipantLayout
        config={config({ layout: 'free', seats: [{ x: 50, y: 50, width: 20 }] })}
        tiles={[tile('1'), tile('2')]}
      />,
    );
    expect(screen.getAllByTestId('participant-tile')).toHaveLength(2);
  });
});

/**
 * Плитка — самая крупная 16:9, что помещается в ячейку. Раньше плитка
 * растягивалась на ячейку, и в узком кадре гость становился вертикальной полосой.
 */
describe('fitTile', () => {
  it('в широком кадре упирается в высоту, в узком — в ширину, и всегда 16:9', () => {
    const wide = fitTile({ width: 1600, height: 400 }, 2, 1, 0);
    expect(wide.height).toBeCloseTo(400);
    expect(wide.width / wide.height).toBeCloseTo(16 / 9);

    const narrow = fitTile({ width: 400, height: 900 }, 3, 1, 0);
    expect(narrow.width).toBeCloseTo(400 / 3);
    expect(narrow.width / narrow.height).toBeCloseTo(16 / 9);
  });

  it('зазоры вычитаются из места под плитки', () => {
    const tile = fitTile({ width: 1000, height: 1000 }, 2, 2, 20);
    expect(tile.width).toBeCloseTo(490);
  });
});
