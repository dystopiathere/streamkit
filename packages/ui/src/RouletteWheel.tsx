import {
  formatMoney,
  type RouletteSpin,
  type RouletteWidgetConfig,
  rouletteGeometry,
} from '@streamkit/contracts';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { isPositioned, slotCss, WidgetFrame } from './slots';
import { textStyleToCss } from './text-style';

export interface RouletteWheelProps {
  config: RouletteWidgetConfig;
  /** Прокрут, который надо сыграть. null — колесо стоит. */
  spin: RouletteSpin | null;
  /** Прокрут сыгран целиком: колесо встало, итог показан и убран. */
  onFinished?: (spinId: string) => void;
}

type Phase = 'idle' | 'spinning' | 'result' | 'leaving';

/**
 * Замедление колеса: сильный толчок и долгий выбег.
 *
 * Первая контрольная точка круто вверх — колесо сразу набирает скорость после
 * замаха, вторая прижата к единице — последние обороты тянутся, и зритель
 * успевает гадать, на каком секторе встанет. Стандартный `ease-out` тормозит
 * равномерно и выглядит как анимация, а не как колесо.
 */
const SPIN_EASING = 'cubic-bezier(0.12, 0.66, 0.08, 1)';
/** Замах назад перед прокрутом: доля длительности и угол. */
const WIND_UP_SHARE = 0.05;
const WIND_UP_DEGREES = 8;
/** Вход и уход колеса, если оно прячется между прокрутами, и уход итога. */
const ENTER_MS = 320;
const LEAVE_MS = 200;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

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

/**
 * Цвет подписи сектора — тёмный или светлый, какой контрастнее.
 *
 * Стример задаёт цвет сектора сам, а белая подпись на жёлтом секторе не
 * читается даже с обводкой. Относительная яркость по WCAG.
 */
function labelColor(hex: string): string {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  const onDark = 1.05 / (luminance + 0.05);
  const onLight = (luminance + 0.05) / 0.055;
  return onLight >= onDark ? '#100F0D' : '#FFFFFF';
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
  const [phase, setPhase] = useState<Phase>('idle');
  const [shown, setShown] = useState<RouletteSpin | null>(null);
  const rotor = useRef<HTMLDivElement>(null);
  const flag = useRef<SVGSVGElement>(null);
  const restRef = useRef(rest);

  const sectors = config.sectors;
  const geometry = rouletteGeometry(sectors);
  const spinId = spin?.id ?? null;

  // Всё, что эффекту прокрута нужно из пропсов, — через ref: иначе правка
  // конфига посреди прокрута перезапускала бы эффект, и колесо дёргалось бы
  // назад к началу. Прокрут идёт по конфигу, с которым начался.
  const latest = useRef({ spin, geometry, config, onFinished });
  useEffect(() => {
    latest.current = { spin, geometry, config, onFinished };
  });

  useEffect(() => {
    if (!spinId) return;
    const { spin: current, geometry: shape, config: settings } = latest.current;
    const element = rotor.current;
    if (!current || !element) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    let frame = 0;
    let animation: Animation | null = null;

    // Сектор ищется по id: стример мог переставить сектора, пока прокрут шёл
    // по шине. Не нашёлся (удалили) — по номеру, в пределах колеса.
    const found = settings.sectors.findIndex((sector) => sector.id === current.sectorId);
    const index = found === -1 ? Math.min(current.sectorIndex, shape.length - 1) : found;
    const target = shape[index]!;
    const pointAt = target.start + current.offset * (target.end - target.start);

    const from = restRef.current;
    const desired = (360 - pointAt + 360) % 360;
    const delta = (((desired - from) % 360) + 360) % 360;
    const to = from + current.turns * 360 + delta;

    const finish = (): void => {
      restRef.current = to;
      setRest(to);
      setPhase('result');
      timers.push(
        setTimeout(() => {
          setPhase('leaving');
          timers.push(
            setTimeout(() => {
              setPhase('idle');
              latest.current.onFinished?.(current.id);
            }, LEAVE_MS),
          );
        }, settings.resultMs),
      );
    };

    timers.push(
      setTimeout(() => {
        setShown(current);
        setPhase('spinning');
      }, 0),
    );

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || typeof element.animate !== 'function') {
      // Без вращения: колесо встаёт на итог сразу, а итог появляется так же,
      // как после прокрута, — смысл события не теряется вместе с движением.
      timers.push(setTimeout(finish, 0));
    } else {
      animation = element.animate(
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
          duration: settings.spinDurationMs,
          // Спрятанное колесо сначала появляется, потом крутится.
          delay: settings.hideWhenIdle ? ENTER_MS : 0,
          fill: 'forwards',
        },
      );
      animation.onfinish = () => {
        element.style.transform = `rotate(${to}deg)`;
        animation?.cancel();
        cancelAnimationFrame(frame);
        finish();
      };

      // Флажок цепляет границу каждого сектора: щелчок на стыке — то, по чему
      // зритель слышит и видит, что колесо замедляется.
      let under = sectorAt(shape, from);
      const tick = (): void => {
        const now = sectorAt(shape, currentAngle(element));
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
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
      cancelAnimationFrame(frame);
      if (animation) {
        // Прерванный прокрут (виджет перенастроили, сцену закрыли) оставляет
        // колесо на месте остановки, а не отбрасывает к началу.
        const angle = currentAngle(element);
        animation.cancel();
        element.style.transform = `rotate(${angle}deg)`;
        restRef.current = angle;
      }
    };
  }, [spinId]);

  const text = textStyleToCss(config.text);
  const size = config.wheelSize;
  const visible = !config.hideWhenIdle || phase !== 'idle';
  const settled = phase === 'result' || phase === 'leaving';
  const winner = settled && shown ? shown : null;
  const winnerIndex = winner ? sectors.findIndex((sector) => sector.id === winner.sectorId) : -1;
  // Кегль подписей — от размера текста колеса (свой у элемента в раскладке),
  // в единицах рисунка: колесо рисуется в круге радиуса 100.
  const wheelFont = config.slots.wheel.fontSize ?? config.text.fontSize;
  const labelSize = Math.min(16, Math.max(5, (wheelFont * 200) / size / 1.6));

  const wheelStyle: CSSProperties = {
    ...slotCss(config.slots.wheel, config.text.fontSize),
    position: isPositioned(config.slots.wheel) ? 'absolute' : 'relative',
    width: size,
    height: size,
    flexShrink: 0,
  };
  // Вход и уход — на внутренней обёртке, а не на элементе кадра: у того свой
  // `transform` (перенос на середину в раскладке), и два трансформа на одном
  // элементе затирают друг друга. Отдельные `scale` и `translate` решили бы
  // это, но они появились в Chromium 104, а браузер-сорс OBS бывает старше.
  const presence: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    opacity: visible ? 1 : 0,
    // Появляется из почти полного размера, а не из точки: колесо, растущее из
    // ничего, читается как всплывающая реклама.
    transform: visible ? 'scale(1)' : 'scale(0.94)',
    transition: visible
      ? `opacity ${ENTER_MS}ms ${EASE_OUT}, transform ${ENTER_MS}ms ${EASE_OUT}`
      : `opacity ${LEAVE_MS}ms ease-out, transform ${LEAVE_MS}ms ease-out`,
  };

  return (
    <WidgetFrame
      testId="roulette"
      background={config.background}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 16,
      }}
    >
      {config.title ? (
        <div
          data-slot="title"
          style={{
            ...text,
            ...slotCss(config.slots.title, config.text.fontSize),
            fontWeight: 700,
            opacity: visible ? 1 : 0,
            transition: `opacity ${ENTER_MS}ms ${EASE_OUT}`,
          }}
        >
          {config.title}
        </div>
      ) : null}

      <div data-slot="wheel" style={wheelStyle}>
        <div style={presence}>
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
        </div>
      </div>

      <div
        data-slot="result"
        role="status"
        style={{
          ...text,
          ...slotCss(config.slots.result, config.text.fontSize),
          textAlign: 'center',
          // Итог занимает место и до появления: иначе в обычной раскладке
          // колесо подпрыгивало бы вверх в момент остановки.
          visibility: winner ? 'visible' : 'hidden',
        }}
      >
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            opacity: phase === 'result' ? 1 : 0,
            transform: phase === 'result' ? 'translateY(0)' : 'translateY(6px)',
            transition:
              phase === 'result'
                ? `opacity 300ms ${EASE_OUT}, transform 300ms ${EASE_OUT}`
                : `opacity ${LEAVE_MS}ms ease-out, transform ${LEAVE_MS}ms ease-out`,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35em', fontWeight: 700 }}>
            <span
              aria-hidden="true"
              style={{
                width: '0.6em',
                height: '0.6em',
                borderRadius: 2,
                background: winner?.color ?? 'transparent',
                boxShadow: `0 0 0 2px ${config.rimColor}`,
                flexShrink: 0,
              }}
            />
            {/* Подпись — из прокрута: сектор могли переименовать, пока колесо крутилось. */}
            <span style={{ color: config.slots.result.color ?? config.text.highlightColor }}>
              {winner?.label ?? ' '}
            </span>
          </span>
          {config.showDonor && winner?.username ? (
            <span style={{ fontSize: '0.6em' }}>
              {winner.username}
              {winner.amount ? ` · ${formatMoney(winner.amount)}` : ''}
            </span>
          ) : null}
        </span>
      </div>
    </WidgetFrame>
  );
}
