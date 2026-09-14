import { type GuestsWidgetConfig, layoutTiles } from '@streamkit/contracts';
import type { ReactNode } from 'react';
import { textStyleToCss } from './text-style';

export interface ParticipantTile {
  /** Устойчивый ключ: идентичность участника в комнате. */
  id: string;
  name: string;
  /** Идёт ли видео прямо сейчас. Без него плитка — имя на тёмном фоне. */
  hasVideo: boolean;
  /**
   * Содержимое плитки: `<video>` в оверлее, заглушка в предпросмотре.
   *
   * Рендерер нарочно не знает про LiveKit. Иначе предпросмотр в редакторе либо
   * тянул бы библиотеку WebRTC ради картинки-примера, либо рисовался бы другим
   * кодом — и «в редакторе одно, в эфире другое» стало бы вопросом времени.
   */
  media?: ReactNode;
}

export interface ParticipantLayoutProps {
  config: GuestsWidgetConfig;
  tiles: ParticipantTile[];
}

/**
 * Гости приватной комнаты в кадре.
 *
 * Плитки растягиваются на весь браузер-сорс: его размер задаёт стример в OBS,
 * а сетке достаточно номеров колонок и рядов, см. `layoutTiles`.
 */
export function ParticipantLayout({
  config,
  tiles,
}: ParticipantLayoutProps): React.JSX.Element | null {
  const shown = tiles
    .filter((tile) => tile.hasVideo || config.showWithoutVideo)
    .slice(0, config.maxTiles);
  if (shown.length === 0) return null;

  const grid = layoutTiles(shown.length, config.layout);
  const text = textStyleToCss(config.text);

  return (
    <div
      data-testid="participant-layout"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${grid.columns}, 1fr)`,
        gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
        gap: config.gap,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {shown.map((tile, index) => {
        const place = grid.tiles[index]!;
        return (
          <div
            key={tile.id}
            data-testid="participant-tile"
            style={{
              gridColumn: `${place.column} / span 2`,
              gridRow: place.row,
              position: 'relative',
              overflow: 'hidden',
              borderRadius: config.cornerRadius,
              // Тёмная подложка, а не прозрачная: плитка без видео иначе
              // превратилась бы в имя, висящее прямо поверх игры.
              background: '#111114',
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {tile.hasVideo ? tile.media : null}

            {config.showNames || !tile.hasVideo ? (
              <span
                style={{
                  ...text,
                  fontSize: config.text.fontSize,
                  position: 'absolute',
                  // Без видео имя встаёт в центр плитки: это и есть весь её смысл.
                  ...(tile.hasVideo
                    ? { left: 12, bottom: 8 }
                    : { inset: 0, display: 'grid', placeItems: 'center' }),
                  maxWidth: 'calc(100% - 24px)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tile.name}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
