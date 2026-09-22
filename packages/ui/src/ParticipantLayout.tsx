import {
  GUEST_TILE_ASPECT,
  guestSeat,
  type GuestsWidgetConfig,
  layoutTiles,
} from '@streamkit/contracts';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
 * Плитка всегда 16:9 — таково видео с камеры. Раньше плитки растягивались на
 * ячейку сетки, и в узком кадре гость превращался в вертикальную полосу с
 * обрезанным лицом. Теперь сетка (CSS Grid, `layoutTiles`) собирается из
 * плиток 16:9 самого крупного размера, который помещается в кадр, и встаёт по
 * центру; размер кадра меряется, потому что его задаёт стример в OBS.
 *
 * Свободная раскладка (`free`) ставит каждого гостя в его место — середина и
 * ширина в процентах кадра, по порядку входа: первый гость — в первое место.
 */
export function ParticipantLayout({
  config,
  tiles,
}: ParticipantLayoutProps): React.JSX.Element | null {
  const box = useRef<HTMLDivElement>(null);
  const size = useBoxSize(box);

  const shown = tiles
    .filter((tile) => tile.hasVideo || config.showWithoutVideo)
    .slice(0, config.maxTiles);
  if (shown.length === 0) return null;

  const text = textStyleToCss(config.text);
  const renderTile = (tile: ParticipantTile, place: CSSProperties) => (
    <div
      key={tile.id}
      data-testid="participant-tile"
      style={{
        position: 'relative',
        ...place,
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

  if (config.layout === 'free') {
    return (
      <div
        ref={box}
        data-testid="participant-layout"
        style={{ position: 'relative', width: '100%', height: '100%', boxSizing: 'border-box' }}
      >
        {shown.map((tile, index) => {
          const seat = guestSeat(config.seats, index);
          // От середины, как элементы кадра остальных виджетов; высоту даёт
          // соотношение сторон, а не конфиг.
          return renderTile(tile, {
            position: 'absolute',
            left: `${seat.x}%`,
            top: `${seat.y}%`,
            width: `${seat.width}%`,
            aspectRatio: `${GUEST_TILE_ASPECT}`,
            transform: 'translate(-50%, -50%)',
          });
        })}
      </div>
    );
  }

  const grid = layoutTiles(shown.length, config.layout);
  const perRow = grid.columns / 2;
  const tile = size ? fitTile(size, perRow, grid.rows, config.gap) : null;

  return (
    <div
      ref={box}
      data-testid="participant-layout"
      style={{
        display: 'grid',
        // Плитка занимает две колонки (центрирование неполного ряда, см.
        // `layoutTiles`), и между ними тоже зазор: колонка — половина плитки
        // без зазора. Пока кадр не измерен — доли, как раньше.
        gridTemplateColumns: tile
          ? `repeat(${grid.columns}, ${(tile.width - config.gap) / 2}px)`
          : `repeat(${grid.columns}, 1fr)`,
        gridTemplateRows: tile
          ? `repeat(${grid.rows}, ${tile.height}px)`
          : `repeat(${grid.rows}, 1fr)`,
        justifyContent: 'center',
        alignContent: 'center',
        gap: config.gap,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {shown.map((participant, index) => {
        const place = grid.tiles[index]!;
        return renderTile(participant, {
          gridColumn: `${place.column} / span 2`,
          gridRow: place.row,
          ...(tile ? {} : { aspectRatio: `${GUEST_TILE_ASPECT}`, alignSelf: 'center' }),
        });
      })}
    </div>
  );
}

/**
 * Самая крупная плитка 16:9, при которой сетка `perRow × rows` с зазорами
 * помещается в кадр. Ни одна сторона плитки не бывает меньше зазора: иначе
 * ширина колонки ушла бы в минус.
 */
export function fitTile(
  size: { width: number; height: number },
  perRow: number,
  rows: number,
  gap: number,
): { width: number; height: number } {
  const cellWidth = (size.width - gap * (perRow - 1)) / perRow;
  const cellHeight = (size.height - gap * (rows - 1)) / rows;
  const width = Math.max(gap, Math.min(cellWidth, cellHeight * GUEST_TILE_ASPECT));
  return { width, height: width / GUEST_TILE_ASPECT };
}

/**
 * Размер элемента, пока он на странице. null — ещё не измерен или браузер не
 * умеет `ResizeObserver` (тесты в jsdom): тогда сетка работает долями.
 */
function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        previous && previous.width === width && previous.height === height
          ? previous
          : width > 0 && height > 0
            ? { width, height }
            : null,
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  });
  return size;
}
