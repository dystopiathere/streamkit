/**
 * @streamkit/app-kit — интерфейс, общий для дашборда и админки.
 *
 * Примитивы, каркас страницы, таблицы, диалог подтверждения, график и клиент
 * API. Рендереры виджетов сюда не относятся: они общие для дашборда и оверлея и
 * живут в `@streamkit/ui`, где нет ни Tailwind, ни роутера.
 *
 * Пакету нужны переводы приложения: `common.newTab`, `common.skipToContent`,
 * `nav.openMenu`, `nav.closeMenu`.
 */
export {
  Button,
  type ButtonProps,
  ButtonLink,
  buttonClasses,
  Card,
  cn,
  describeField,
  FieldError,
  FieldHint,
  Input,
  Label,
  NewTabHint,
  selectClasses,
  VisuallyHidden,
} from './primitives';
export {
  MAIN_ID,
  MainContent,
  MenuButton,
  SkipLink,
  useCollapsibleMenu,
  usePageTitle,
} from './layout';
export {
  type Column,
  DataTable,
  DetailList,
  EmptyState,
  LoadMore,
  StatusPill,
  type StatusTone,
} from './data';
export { ConfirmDialog, type ConfirmDialogProps } from './dialog';
export {
  type SeriesPoint,
  seriesSummary,
  TimeSeriesChart,
  type TimeSeriesChartProps,
} from './chart';
export {
  type ApiClient,
  type ApiClientOptions,
  ApiError,
  createApiClient,
  type RequestOptions,
  type SessionStore,
} from './api-client';
