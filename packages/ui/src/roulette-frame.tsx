import { formatMoney, type RouletteSpin, type RouletteWidgetConfig } from '@streamkit/contracts';
import type { CSSProperties, ReactNode } from 'react';
import { isPositioned, slotCss, WidgetFrame } from './slots';
import { textStyleToCss } from './text-style';
import { EASE_OUT, ENTER_MS, LEAVE_MS, type SpinPhase } from './roulette-spin';

/**
 * Кадр рулетки: заголовок, место под саму рулетку и итог прокрута.
 *
 * Общий для колеса и вертикальной ленты — у них отличается только то, что
 * крутится. Итог, подпись и выход из кадра у обоих обязаны выглядеть
 * одинаково: это один и тот же виджет, а не два.
 */
export function RouletteFrame({
  config,
  phase,
  winner,
  children,
}: {
  config: RouletteWidgetConfig;
  phase: SpinPhase;
  /** Выпавший сектор, когда рулетка уже встала. null — идёт прокрут или покой. */
  winner: RouletteSpin | null;
  /** Сама рулетка: колесо или лента. */
  children: (visible: boolean) => ReactNode;
}): React.JSX.Element {
  const text = textStyleToCss(config.text);
  const visible = !config.hideWhenIdle || phase !== 'idle';
  const size = config.wheelSize;

  const boardStyle: CSSProperties = {
    ...slotCss(config.slots.wheel, config.text.fontSize),
    position: isPositioned(config.slots.wheel) ? 'absolute' : 'relative',
    width: config.mode === 'vertical' ? '100%' : size,
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
    // Появляется из почти полного размера, а не из точки: рулетка, растущая из
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

      <div data-slot="wheel" style={boardStyle}>
        <div style={presence}>{children(visible)}</div>
      </div>

      <div
        data-slot="result"
        role="status"
        style={{
          ...text,
          ...slotCss(config.slots.result, config.text.fontSize),
          textAlign: 'center',
          // Итог занимает место и до появления: иначе в обычной раскладке
          // рулетка подпрыгивала бы вверх в момент остановки.
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
            {/* Подпись — из прокрута: сектор могли переименовать, пока рулетка крутилась. */}
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
