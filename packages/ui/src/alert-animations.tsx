import type { AlertScenarioConfig } from '@streamkit/contracts';

/**
 * Keyframes для анимаций появления и ухода алерта.
 *
 * Держим их строкой, а не файлом CSS: пакет подключают и Vite-приложение с
 * Tailwind, и минимальный overlay без пайплайна стилей вообще. Строку вставляет
 * `AlertAnimationStyles`, и ни одному потребителю не нужно настраивать импорт CSS.
 *
 * Анимируются только transform и opacity — единственные свойства, которые браузер
 * считает на композиторе. Анимация top/left в браузер-сорсе OBS даёт дёрганье
 * ровно в тот момент, когда на стриме что-то происходит.
 */
export const ALERT_KEYFRAMES = `
@keyframes sk-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes sk-slide-up {
  from { opacity: 0; transform: translate3d(0, 24px, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes sk-slide-left {
  from { opacity: 0; transform: translate3d(32px, 0, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes sk-zoom {
  from { opacity: 0; transform: scale3d(0.88, 0.88, 1); }
  to { opacity: 1; transform: scale3d(1, 1, 1); }
}
@keyframes sk-bounce {
  0% { opacity: 0; transform: scale3d(0.7, 0.7, 1); }
  55% { opacity: 1; transform: scale3d(1.06, 1.06, 1); }
  100% { opacity: 1; transform: scale3d(1, 1, 1); }
}
@keyframes sk-out-fade {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes sk-out-slide-up {
  from { opacity: 1; transform: translate3d(0, 0, 0); }
  to { opacity: 0; transform: translate3d(0, -24px, 0); }
}
@keyframes sk-out-slide-left {
  from { opacity: 1; transform: translate3d(0, 0, 0); }
  to { opacity: 0; transform: translate3d(-32px, 0, 0); }
}
@keyframes sk-out-zoom {
  from { opacity: 1; transform: scale3d(1, 1, 1); }
  to { opacity: 0; transform: scale3d(0.9, 0.9, 1); }
}
@keyframes sk-out-bounce {
  from { opacity: 1; transform: scale3d(1, 1, 1); }
  to { opacity: 0; transform: scale3d(0.7, 0.7, 1); }
}

/* Анимации продвинутого оформления (тариф «Про»). Уход у них зеркальный входу:
   алерт, приехавший сверху, уходит вверх — иначе движение читается как рывок. */
@keyframes sk-slide-down {
  from { opacity: 0; transform: translate3d(0, -24px, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes sk-out-slide-down {
  from { opacity: 1; transform: translate3d(0, 0, 0); }
  to { opacity: 0; transform: translate3d(0, 24px, 0); }
}
@keyframes sk-slide-right {
  from { opacity: 0; transform: translate3d(-32px, 0, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes sk-out-slide-right {
  from { opacity: 1; transform: translate3d(0, 0, 0); }
  to { opacity: 0; transform: translate3d(32px, 0, 0); }
}
@keyframes sk-pop {
  0% { opacity: 0; transform: scale3d(0.2, 0.2, 1); }
  60% { opacity: 1; transform: scale3d(1.12, 1.12, 1); }
  100% { opacity: 1; transform: scale3d(1, 1, 1); }
}
@keyframes sk-out-pop {
  from { opacity: 1; transform: scale3d(1, 1, 1); }
  to { opacity: 0; transform: scale3d(0.2, 0.2, 1); }
}
@keyframes sk-flip {
  from { opacity: 0; transform: perspective(800px) rotate3d(1, 0, 0, 90deg); }
  to { opacity: 1; transform: perspective(800px) rotate3d(1, 0, 0, 0deg); }
}
@keyframes sk-out-flip {
  from { opacity: 1; transform: perspective(800px) rotate3d(1, 0, 0, 0deg); }
  to { opacity: 0; transform: perspective(800px) rotate3d(1, 0, 0, -90deg); }
}
@keyframes sk-shake {
  0% { opacity: 0; transform: translate3d(0, 0, 0); }
  20% { opacity: 1; transform: translate3d(-10px, 0, 0); }
  40% { transform: translate3d(9px, 0, 0); }
  60% { transform: translate3d(-6px, 0, 0); }
  80% { transform: translate3d(3px, 0, 0); }
  100% { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes sk-out-shake {
  0% { opacity: 1; transform: translate3d(0, 0, 0); }
  50% { transform: translate3d(8px, 0, 0); }
  100% { opacity: 0; transform: translate3d(-24px, 0, 0); }
}
@keyframes sk-swing {
  0% { opacity: 0; transform: rotate3d(0, 0, 1, -12deg); }
  50% { opacity: 1; transform: rotate3d(0, 0, 1, 8deg); }
  75% { transform: rotate3d(0, 0, 1, -4deg); }
  100% { opacity: 1; transform: rotate3d(0, 0, 1, 0deg); }
}
@keyframes sk-out-swing {
  from { opacity: 1; transform: rotate3d(0, 0, 1, 0deg); }
  to { opacity: 0; transform: rotate3d(0, 0, 1, 14deg); }
}
`;

/** Длительность анимации ухода. Учитывается в очереди показа. */
export const ALERT_EXIT_DURATION_MS = 300;

export function exitAnimationName(animation: AlertScenarioConfig['animationOut']): string {
  return `sk-out-${animation}`;
}

/** Подключает keyframes. Вставлять один раз на страницу. */
export function AlertAnimationStyles(): React.JSX.Element {
  return <style>{ALERT_KEYFRAMES}</style>;
}
