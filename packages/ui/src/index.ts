/**
 * @streamkit/ui — компоненты, общие для дашборда и overlay.
 *
 * Здесь живёт только то, что обязано выглядеть одинаково в обоих приложениях:
 * рендерер виджета и логика очереди показа. Элементы интерфейса дашборда
 * (кнопки, поля, диалоги) сюда не выносятся — они нужны ровно в одном месте.
 */
export { AlertCard, type AlertCardProps } from './AlertCard';
export {
  ALERT_EXIT_DURATION_MS,
  ALERT_KEYFRAMES,
  AlertAnimationStyles,
  exitAnimationName,
} from './alert-animations';
export { useAlertQueue, type QueuedAlert } from './useAlertQueue';
