import type { RouletteSpin, RouletteSector, RouletteWidgetConfig } from '@streamkit/contracts';
import { type CSSProperties, useRef, useState } from 'react';
import {
  EASE_OUT,
  ENTER_MS,
  labelColor,
  SPIN_EASING,
  useSpinPhases,
  WIND_UP_SHARE,
} from './roulette-spin';
import { RouletteFrame } from './roulette-frame';
import { textStyleToCss } from './text-style';

export interface RouletteReelProps {
  config: RouletteWidgetConfig;
  /** Прокрут, который надо сыграть. null — лента стоит. */
  spin: RouletteSpin | null;
  /** Прокрут сыгран целиком: лента встала, итог показан и убран. */
  onFinished?: (spinId: string) => void;
}

/** Сколько позиций видно в окне ленты. Нечётное — чтобы середина была одна. */
const VISIBLE_ITEMS = 5;
/**
 * Сколько позиций проходит мимо метки за прокрут: не меньше и не больше.
 *
 * Меньше двух десятков — это переезд на соседнюю строку, а не прокрут: зрителю
 * нечего гадать. Больше шести — сплошная полоса, в которой всё равно ничего не
 * разобрать, а браузер-сорс рисует лишние кадры.
 */
const MIN_TRAVEL_ITEMS = 25;
const MAX_TRAVEL_ITEMS = 60;
/** Потолок отрисованных позиций: лента из ста строк не должна плодить тысячи узлов. */
const MAX_RENDERED_ITEMS = 520;
/** Насколько сильно точка остановки уводит позицию от середины метки. */
const OFFSET_DAMPING = 0.5;
/** Замах назад перед прокрутом, в долях высоты позиции. */
const WIND_UP_ITEMS = 0.12;

/**
 * Раскладка ленты: высота каждой позиции и её середина от верха одного круга.
 *
 * Высота — доля веса, как доля круга у сектора колеса: что видят зрители, то и
 * выпадает. Средняя позиция при этом всегда одного размера, сколько бы их ни
 * было, поэтому круг ленты ровно `count × base` — и с двумя позициями, и со ста.
 */
export function reelGeometry(
  sectors: readonly Pick<RouletteSector, 'weight'>[],
  base: number,
): { heights: number[]; centers: number[]; cycle: number } {
  const total = sectors.reduce((sum, sector) => sum + sector.weight, 0) || 1;
  const heights = sectors.map((sector) => (sector.weight / total) * sectors.length * base);
  const centers: number[] = [];
  let cursor = 0;
  for (const height of heights) {
    centers.push(cursor + height / 2);
    cursor += height;
  }
  return { heights, centers, cycle: cursor };
}

/**
 * Вертикальная рулетка: лента позиций, которая проматывается мимо метки.
 *
 * Зачем она есть рядом с колесом: на колесе больше двух десятков подписей не
 * читаются ни с какой стороны — они становятся спицами. В ленте подпись
 * горизонтальная и всегда одной длины, поэтому в неё помещается сотня позиций
 * (`MAX_VERTICAL_SECTORS`), и розыгрыш среди зрителей по списку — это она.
 *
 * Цвет здесь не различает позиции: сотню цветов различить нельзя, а палитра
 * проверена на восьми. Цвет — это полоса слева, а опознают позицию по подписи.
 *
 * Сектор, точку остановки и число кругов присылает сервер — оверлей только
 * доводит ленту до них, и две сцены OBS с одной ссылкой встают одинаково.
 */
export function RouletteReel({ config, spin, onFinished }: RouletteReelProps): React.JSX.Element {
  const sectors = config.sectors;
  const height = config.wheelSize;
  const base = height / VISIBLE_ITEMS;
  const { heights, centers, cycle } = reelGeometry(sectors, base);

  /** Сдвиг ленты, при котором середина позиции стоит под меткой в круге `copy`. */
  const positionOf = (index: number, damping: number, copy: number): number =>
    height / 2 - centers[index]! - damping - copy * cycle;

  // Кругов сверху столько, чтобы над окном всегда было содержимое — и в покое,
  // и на замахе. Лента стоит в круге `pad`, и выше неё остаётся `pad` кругов.
  const pad = Math.max(1, Math.ceil((height / 2 + WIND_UP_ITEMS * base) / cycle));

  // В покое под меткой стоит первая позиция.
  const [rest, setRest] = useState(() => positionOf(0, 0, pad));

  const travelPlan = (index: number, damping: number, from: number): ReelTravel =>
    reelTravel({
      from,
      anchor: positionOf(index, damping, 0),
      cycle,
      base,
      turns: spin?.turns ?? 1,
      // Потолок отрисовки: лента из ста позиций и без того длинная, и лишние
      // круги здесь — тысячи узлов в браузер-сорсе.
      maxCycles: Math.max(0, Math.floor(MAX_RENDERED_ITEMS / sectors.length) - 2 * pad - 2),
    });

  // Кругов рисуем столько, чтобы хватило на весь путь и осталось содержимое
  // сверху и снизу от окна в конце.
  const copies = 2 * pad + 2 + (spin ? travelPlan(spinTarget(sectors, spin), 0, rest).cycles : 0);
  const strip = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const restRef = useRef(rest);

  const { phase, shown } = useSpinPhases(
    spin,
    config,
    (current, finish, reduced) => {
      const element = strip.current;
      if (!element) return;

      const index = spinTarget(sectors, current);
      // Остановка чуть мимо середины метки — как у настоящего барабана; но
      // не у края позиции, иначе непонятно, что выпало.
      const damping = (current.offset - 0.5) * OFFSET_DAMPING * heights[index]!;

      const from = restRef.current;
      const { to } = travelPlan(index, damping, from);
      // Следующий прокрут начинается там же, где этот кончился: лента
      // повторяется, поэтому сдвиг на целые круги глазу незаметен.
      const settled = positionOf(index, damping, pad);

      const land = (): void => {
        element.style.transform = `translateY(${settled}px)`;
        restRef.current = settled;
        setRest(settled);
        finish();
      };

      if (reduced || typeof element.animate !== 'function') {
        land();
        return;
      }

      const animation = element.animate(
        [
          { transform: `translateY(${from}px)`, easing: 'cubic-bezier(0.3, 0, 0.4, 1)' },
          {
            transform: `translateY(${from + WIND_UP_ITEMS * base}px)`,
            offset: WIND_UP_SHARE,
            easing: SPIN_EASING,
          },
          { transform: `translateY(${to}px)` },
        ],
        {
          duration: config.spinDurationMs,
          // Спрятанная лента сначала появляется, потом крутится.
          delay: config.hideWhenIdle ? ENTER_MS : 0,
          fill: 'forwards',
        },
      );

      // Метка вздрагивает на каждой границе позиций — по этому видно и слышно,
      // что лента замедляется.
      let frame = 0;
      let under = -1;
      const tick = (): void => {
        const shift = currentShift(element);
        const now = Math.floor((height / 2 - shift) / base);
        if (under !== -1 && now !== under) {
          marker.current?.animate(
            [{ transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
            { duration: 120, easing: EASE_OUT },
          );
        }
        under = now;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      animation.onfinish = () => {
        animation.cancel();
        cancelAnimationFrame(frame);
        land();
      };

      return () => {
        cancelAnimationFrame(frame);
        // Прерванный прокрут оставляет ленту там, где её застали.
        const shift = currentShift(element);
        animation.cancel();
        element.style.transform = `translateY(${shift}px)`;
        restRef.current = shift;
      };
    },
    onFinished,
  );

  const text = textStyleToCss(config.text);
  const settledPhase = phase === 'result' || phase === 'leaving';
  const winner = settledPhase && shown ? shown : null;
  const winnerId = winner?.sectorId ?? null;
  // Кегль подписи — от размера текста ленты (свой у элемента в раскладке), но
  // не выше половины позиции: подпись обязана помещаться в свою полосу.
  const fontSize = Math.min(
    config.slots.wheel.fontSize ?? config.text.fontSize,
    Math.round(base * 0.5),
  );

  return (
    <RouletteFrame config={config} phase={phase} winner={winner}>
      {() => (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            borderRadius: 8,
            background: config.rimColor,
            boxShadow: `inset 0 0 0 3px ${config.rimColor}`,
          }}
        >
          <div
            ref={strip}
            data-testid="roulette-strip"
            style={{ transform: `translateY(${rest}px)`, willChange: 'transform' }}
          >
            {Array.from({ length: copies }, (_, copy) =>
              sectors.map((sector, index) => (
                <div
                  key={`${copy}-${sector.id}`}
                  style={{
                    height: heights[index],
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    // Поля шире штрихов метки: подпись не должна начинаться
                    // под ними, иначе первая буква выглядит перечёркнутой.
                    padding: '0 22px',
                    // Зазор между позициями — цветом обода, как спицы на колесе.
                    boxShadow: `inset 0 -2px 0 ${config.rimColor}`,
                    background: sector.color,
                    color: config.slots.wheel.color ?? labelColor(sector.color),
                    opacity: winnerId && sector.id !== winnerId ? 0.32 : 1,
                    transition: `opacity 260ms ${EASE_OUT}`,
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      ...text,
                      color: 'inherit',
                      fontSize,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {sector.label}
                  </span>
                </div>
              )),
            )}
          </div>

          {/* Края ленты гаснут: позиция, обрезанная границей окна, иначе
              выглядит как ошибка вёрстки, а не как лента, уходящая за кадр. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background:
                'linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0) 16%, rgba(0,0,0,0) 84%, rgba(0,0,0,0.5))',
            }}
          />

          {/* Метка: треугольники у краёв и короткие штрихи от них — как флажок
              у колеса, только неподвижна тут лента, а не он. Через всю ширину
              линию не ведём: она перечёркивала бы подпись выпавшей позиции. */}
          <div
            ref={marker}
            aria-hidden="true"
            style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 0 }}
          >
            <div style={markerTick(config, 'right')} />
            <div style={markerTick(config, 'left')} />
            <div style={markerArrow(config, 'right')} />
            <div style={markerArrow(config, 'left')} />
          </div>
        </div>
      )}
    </RouletteFrame>
  );
}

/** Короткий штрих метки от края: подпись он не задевает. */
function markerTick(config: RouletteWidgetConfig, side: 'left' | 'right'): CSSProperties {
  return {
    position: 'absolute',
    [side]: 0,
    top: -1,
    width: 14,
    height: 2,
    background: config.text.highlightColor,
    boxShadow: `0 0 0 1px ${config.rimColor}`,
  } as CSSProperties;
}

export interface ReelTravel {
  /** Куда встанет лента. */
  to: number;
  /** Сколько целых кругов пройдёт мимо метки сверх доводки. */
  cycles: number;
}

/**
 * Куда и сколько ехать.
 *
 * Путь — это доводка до выпавшей позиции плюс целые круги. Без кругов лента
 * просто переезжает на победителя, и прокрута не видно: именно так и выглядела
 * первая версия. Кругов берётся столько, чтобы мимо метки прошло от
 * `MIN_TRAVEL_ITEMS` до `MAX_TRAVEL_ITEMS` позиций — и когда их шесть в списке,
 * и когда сто. У длинного списка один круг длиннее потолка, и тогда потолок
 * уступает: доехать можно только до выпавшей позиции, а не «примерно туда».
 */
export function reelTravel({
  from,
  anchor,
  cycle,
  base,
  turns,
  maxCycles,
}: {
  /** Где лента стоит сейчас. */
  from: number;
  /** Положение, при котором выпавшая позиция стоит под меткой (круг 0). */
  anchor: number;
  cycle: number;
  /** Высота средней позиции: ею меряется путь. */
  base: number;
  /** Сколько кругов просил сервер. */
  turns: number;
  /** Сколько целых кругов можно себе позволить по числу отрисованных узлов. */
  maxCycles: number;
}): ReelTravel {
  // Доводка внутри круга: лента едет вверх, поэтому остаток берётся по модулю
  // круга — иначе «назад на полкруга» выглядело бы рывком в другую сторону.
  const align = modulo(from - anchor, cycle);
  const desired = Math.min(turns * cycle, MAX_TRAVEL_ITEMS * base);
  let cycles = Math.max(0, Math.round((desired - align) / cycle));
  if (align + cycles * cycle < MIN_TRAVEL_ITEMS * base) cycles += 1;
  cycles = Math.min(cycles, Math.max(0, maxCycles));
  return { to: from - align - cycles * cycle, cycles };
}

/**
 * Какая позиция выпала. Ищется по id: стример мог переставить список, пока
 * прокрут шёл по шине. Не нашлась (удалили) — по номеру, в пределах ленты.
 */
function spinTarget(
  sectors: readonly RouletteSector[],
  spin: Pick<RouletteSpin, 'sectorId' | 'sectorIndex'>,
): number {
  const found = sectors.findIndex((sector) => sector.id === spin.sectorId);
  return found === -1 ? Math.min(spin.sectorIndex, sectors.length - 1) : found;
}

/** Остаток от деления, всегда неотрицательный: `%` у отрицательных даёт минус. */
function modulo(value: number, span: number): number {
  return ((value % span) + span) % span;
}

/** Треугольник метки у края ленты. */
function markerArrow(config: RouletteWidgetConfig, side: 'left' | 'right'): CSSProperties {
  const size = 10;
  return {
    position: 'absolute',
    [side]: 0,
    top: -size,
    width: 0,
    height: 0,
    borderTop: `${size}px solid transparent`,
    borderBottom: `${size}px solid transparent`,
    [side === 'right' ? 'borderRight' : 'borderLeft']:
      `${size}px solid ${config.text.highlightColor}`,
  } as CSSProperties;
}

/** Текущий сдвиг ленты из вычисленного `transform` — чтобы метка знала, что под ней. */
function currentShift(element: HTMLElement): number {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
  return matrix.f;
}
