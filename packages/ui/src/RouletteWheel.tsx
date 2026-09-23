import {
  type RouletteSpin,
  type RouletteWidgetConfig,
  rouletteGeometry,
} from '@streamkit/contracts';
import { useRef, useState } from 'react';
import { RouletteFrame } from './roulette-frame';
import {
  EASE_OUT,
  ENTER_MS,
  labelColor,
  SPIN_EASING,
  useSpinPhases,
  WIND_UP_SHARE,
} from './roulette-spin';
import { textStyleToCss } from './text-style';

export interface RouletteWheelProps {
  config: RouletteWidgetConfig;
  /** Прокрут, который надо сыграть. null — колесо стоит. */
  spin: RouletteSpin | null;
  /** Прокрут сыгран целиком: колесо встало, итог показан и убран. */
  onFinished?: (spinId: string) => void;
}

/** Замах назад перед прокрутом: угол. */
const WIND_UP_DEGREES = 8;

/** Кольцо в координатах SVG: колесо — круг радиуса 100 вокруг начала. */
const RIM_RADIUS = 97;
const LABEL_OUTER = 88;
const HUB_RADIUS = 17;

/** Угол поворота из вычисленного `transform` — чтобы флажок знал, какой сектор под ним. */
function currentAngle(element: HTMLElement): number {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
  const degrees = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/** Какой сектор под указателем при повороте колеса на `rotation` градусов. */
function sectorAt(geometry: { start: number; end: number }[], rotation: number): number {
  const angle = (((360 - rotation) % 360) + 360) % 360;
  const index = geometry.findIndex((sector) => angle >= sector.start && angle < sector.end);
  return index === -1 ? geometry.length - 1 : index;
}

function restingAngle(sectors: RouletteWidgetConfig['sectors']): number {
  const first = rouletteGeometry(sectors)[0];
  return first ? -(first.start + first.end) / 2 : 0;
}

function polar(radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [radius * Math.cos(radians), radius * Math.sin(radians)];
}

function sectorPath(start: number, end: number): string {
  // Сектор во весь круг — одна дуга не рисуется: начало совпадает с концом.
  if (end - start >= 359.99) {
    return `M 0 ${-RIM_RADIUS} A ${RIM_RADIUS} ${RIM_RADIUS} 0 1 1 0 ${RIM_RADIUS} A ${RIM_RADIUS} ${RIM_RADIUS} 0 1 1 0 ${-RIM_RADIUS} Z`;
  }
  const [x1, y1] = polar(RIM_RADIUS, start);
  const [x2, y2] = polar(RIM_RADIUS, end);
  const large = end - start > 180 ? 1 : 0;
  return `M 0 0 L ${x1} ${y1} A ${RIM_RADIUS} ${RIM_RADIUS} 0 ${large} 1 ${x2} ${y2} Z`;
}

/**
 * Подпись сектора: от ступицы к ободу, обрезанная по длине.
 *
 * В SVG нет многоточия, поэтому длина считается по ширине знака: подпись,
 * заехавшая на обод или соседний сектор, выглядит как ошибка вёрстки.
 */
function fitLabel(label: string, size: number): string {
  const room = LABEL_OUTER - HUB_RADIUS - 6;
  const max = Math.max(3, Math.floor(room / (size * 0.56)));
  const chars = Array.from(label);
  return chars.length <= max
    ? label
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/**
 * Колесо рулетки.
 *
 * Сектор, точку остановки и число оборотов присылает сервер: оверлей только
 * доводит колесо до них, и две сцены OBS с одной ссылкой встают одинаково.
 * Доля круга у сектора — доля его веса: зрители видят настоящие шансы.
 *
 * Колесо крутит Web Animations API, а не CSS-переход: угол цели считается в
 * момент прокрута, а флажку нужен текущий угол на каждом кадре. Между
 * прокрутами колесо стоит там, где остановилось, — следующий прокрут
 * начинается оттуда, а не с нуля.
 */
export function RouletteWheel({ config, spin, onFinished }: RouletteWheelProps): React.JSX.Element {
  // В покое указатель смотрит в середину первого сектора, а не на штифт между
  // двумя: стрелка на границе в первом же кадре выглядит спорной.
  const [rest, setRest] = useState(() => restingAngle(config.sectors));
  const rotor = useRef<HTMLDivElement>(null);
  const flag = useRef<SVGSVGElement>(null);
  const restRef = useRef(rest);

  const sectors = config.sectors;
  const geometry = rouletteGeometry(sectors);

  const { phase, shown } = useSpinPhases(
    spin,
    config,
    (current, finish, reduced) => {
      const element = rotor.current;
      if (!element) return;

      // Сектор ищется по id: стример мог переставить сектора, пока прокрут шёл
      // по шине. Не нашёлся (удалили) — по номеру, в пределах колеса.
      const found = sectors.findIndex((sector) => sector.id === current.sectorId);
      const index = found === -1 ? Math.min(current.sectorIndex, geometry.length - 1) : found;
      const target = geometry[index]!;
      const pointAt = target.start + current.offset * (target.end - target.start);

      const from = restRef.current;
      const desired = (360 - pointAt + 360) % 360;
      const delta = (((desired - from) % 360) + 360) % 360;
      const to = from + current.turns * 360 + delta;

      const land = (): void => {
        restRef.current = to;
        setRest(to);
        finish();
      };

      if (reduced || typeof element.animate !== 'function') {
        land();
        return;
      }

      const animation = element.animate(
        [
          { transform: `rotate(${from}deg)`, easing: 'cubic-bezier(0.3, 0, 0.4, 1)' },
          {
            transform: `rotate(${from - WIND_UP_DEGREES}deg)`,
            offset: WIND_UP_SHARE,
            easing: SPIN_EASING,
          },
          { transform: `rotate(${to}deg)` },
        ],
        {
          duration: config.spinDurationMs,
          // Спрятанное колесо сначала появляется, потом крутится.
          delay: config.hideWhenIdle ? ENTER_MS : 0,
          fill: 'forwards',
        },
      );

      // Флажок цепляет границу каждого сектора: щелчок на стыке — то, по чему
      // зритель слышит и видит, что колесо замедляется.
      let frame = 0;
      let under = sectorAt(geometry, from);
      const tick = (): void => {
        const now = sectorAt(geometry, currentAngle(element));
        if (now !== under) {
          under = now;
          flag.current?.animate([{ transform: 'rotate(-24deg)' }, { transform: 'rotate(0deg)' }], {
            duration: 140,
            easing: EASE_OUT,
          });
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      animation.onfinish = () => {
        element.style.transform = `rotate(${to}deg)`;
        animation.cancel();
        cancelAnimationFrame(frame);
        land();
      };

      return () => {
        cancelAnimationFrame(frame);
        // Прерванный прокрут (виджет перенастроили, сцену закрыли) оставляет
        // колесо на месте остановки, а не отбрасывает к началу.
        const angle = currentAngle(element);
        animation.cancel();
        element.style.transform = `rotate(${angle}deg)`;
        restRef.current = angle;
      };
    },
    onFinished,
  );

  const text = textStyleToCss(config.text);
  const size = config.wheelSize;
  const settled = phase === 'result' || phase === 'leaving';
  const winner = settled && shown ? shown : null;
  const winnerIndex = winner ? sectors.findIndex((sector) => sector.id === winner.sectorId) : -1;
  // Кегль подписей — от размера текста колеса (свой у элемента в раскладке),
  // в единицах рисунка: колесо рисуется в круге радиуса 100.
  const wheelFont = config.slots.wheel.fontSize ?? config.text.fontSize;
  const labelSize = Math.min(16, Math.max(5, (wheelFont * 200) / size / 1.6));

  return (
    <RouletteFrame config={config} phase={phase} winner={winner}>
      {() => (
        <>
          <div
            ref={rotor}
            data-testid="roulette-rotor"
            style={{ width: '100%', height: '100%', transform: `rotate(${rest}deg)` }}
          >
            <svg viewBox="-100 -100 200 200" width="100%" height="100%" aria-hidden="true">
              <circle r={100} fill={config.rimColor} />
              {geometry.map((shape, index) => {
                const sector = sectors[index]!;
                const middle = (shape.start + shape.end) / 2;
                const [x, y] = polar(LABEL_OUTER, middle);
                // Кегль ограничен и шириной сектора: у узкого сектора подпись
                // иначе наезжала бы на соседей.
                const arc = ((shape.end - shape.start) * Math.PI * 55) / 180;
                const fontSize = Math.min(labelSize, arc * 0.8);
                const dimmed = winnerIndex !== -1 && index !== winnerIndex;
                return (
                  <g
                    key={sector.id}
                    style={{
                      opacity: dimmed ? 0.32 : 1,
                      transition: `opacity 260ms ${EASE_OUT}`,
                    }}
                  >
                    <path
                      d={sectorPath(shape.start, shape.end)}
                      fill={sector.color}
                      stroke={config.rimColor}
                      strokeWidth={1.1}
                      strokeLinejoin="round"
                    />
                    {fontSize >= 4 ? (
                      <text
                        x={x}
                        y={y}
                        // На левой половине колеса подпись разворачивается и
                        // читается от обода: иначе в покое она вверх ногами.
                        transform={`rotate(${middle > 180 ? middle + 90 : middle - 90} ${x} ${y})`}
                        textAnchor={middle > 180 ? 'start' : 'end'}
                        dominantBaseline="central"
                        fill={config.slots.wheel.color ?? labelColor(sector.color)}
                        style={{
                          fontFamily: text.fontFamily,
                          fontSize,
                          fontWeight: 700,
                          textTransform: config.text.uppercase ? 'uppercase' : 'none',
                        }}
                      >
                        {fitLabel(sector.label, fontSize)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              <circle r={RIM_RADIUS} fill="none" stroke={config.rimColor} strokeWidth={3} />
              {/* Штифты на стыках секторов: о них цепляется флажок. */}
              {geometry.map((shape, index) => {
                const [x, y] = polar(RIM_RADIUS - 0.5, shape.start);
                return <circle key={index} cx={x} cy={y} r={1.6} fill={config.text.color} />;
              })}
              <circle r={HUB_RADIUS} fill={config.rimColor} />
              <circle r={HUB_RADIUS - 6} fill="none" stroke={config.text.color} strokeWidth={1.2} />
              <path
                d={`M ${-(HUB_RADIUS - 9)} 0 H ${HUB_RADIUS - 9} M 0 ${-(HUB_RADIUS - 9)} V ${HUB_RADIUS - 9}`}
                stroke={config.text.color}
                strokeWidth={1}
              />
            </svg>
          </div>

          {/* Флажок стоит, крутится колесо под ним. */}
          <svg
            ref={flag}
            viewBox="-10 -4 20 26"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              width: size * 0.1,
              marginLeft: -size * 0.05,
              marginTop: -size * 0.035,
              transformOrigin: '50% 15%',
              overflow: 'visible',
            }}
          >
            <path
              d="M -8 0 H 8 L 0 20 Z"
              fill={config.text.highlightColor}
              stroke={config.rimColor}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </svg>
        </>
      )}
    </RouletteFrame>
  );
}
