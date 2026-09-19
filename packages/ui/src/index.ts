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
export { ChatBox, type ChatBoxProps } from './ChatBox';
export { PlatformIcon } from './PlatformIcon';
export { GoalBar, type GoalBarProps } from './GoalBar';
export {
  ParticipantLayout,
  type ParticipantLayoutProps,
  type ParticipantTile,
} from './ParticipantLayout';
export { textStyleToCss } from './text-style';
export { TimerDisplay, type TimerDisplayProps } from './TimerDisplay';
export { TopDonorsList, type TopDonorsListProps } from './TopDonorsList';
export { useAlertQueue, type QueuedAlert } from './useAlertQueue';
