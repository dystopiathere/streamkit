import {
  type AlertEvent,
  EVENTS_PAGE_SIZES,
  SOCKET_EVENTS,
  alertEventSchema,
} from '@streamkit/contracts';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Pagination, selectClasses, usePageTitle } from '@streamkit/app-kit';
import { useEventsPage } from '@/features/widgets/queries';
import { useDashboardSocket } from '@/lib/useDashboardSocket';
import { formatMoney, intlLocale } from '@/lib/locale';

/** Сколько живых событий держим в памяти. Остальное есть в истории. */
const LIVE_BUFFER = 50;

type PageSize = (typeof EVENTS_PAGE_SIZES)[number];

/**
 * История событий — по страницам.
 *
 * Страницы отсчитываются от момента, когда их открыли (`until`): донат,
 * пришедший во время листания, не сдвигает строки между страницами. На свежей
 * первой странице новые события встают сверху сами — это лента, ради которой
 * вкладку держат открытой во время эфира. Ушли листать — новые копятся в
 * счётчике над списком и показываются по кнопке.
 */
export function EventsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  // null — «от сейчас»: свежая первая страница. Листание фиксирует отсечку.
  const [until, setUntil] = useState<string | null>(null);
  const [live, setLive] = useState<AlertEvent[]>([]);
  const [waiting, setWaiting] = useState(0);
  // «Сегодня» — один раз при открытии: часы во время рендера не читаются.
  const [today] = useState(() => new Date().toDateString());
  const history = useEventsPage(page, pageSize, until);
  usePageTitle(t('events.title'));

  const fresh = page === 1 && until === null;

  useDashboardSocket(
    SOCKET_EVENTS.eventCreated,
    useCallback(
      (payload: unknown) => {
        const parsed = alertEventSchema.safeParse((payload as { event?: unknown })?.event);
        if (!parsed.success) return;
        if (fresh) setLive((current) => [parsed.data, ...current].slice(0, LIVE_BUFFER));
        else setWaiting((count) => count + 1);
      },
      [fresh],
    ),
  );

  const goTo = (next: number): void => {
    // Первый уход с живой первой страницы фиксирует её отсечку: следующие
    // страницы считаются от того же момента, что и та, с которой ушли.
    setUntil((current) => current ?? history.data?.until ?? null);
    setPage(next);
    setLive([]);
    document.getElementById('events-feed')?.focus();
  };

  const showNewest = (): void => {
    setUntil(null);
    setPage(1);
    setLive([]);
    setWaiting(0);
  };

  // Живые события — сверху свежей первой страницы; дубли отсекаются по id:
  // после перезапроса то же событие придёт и из истории.
  const seen = new Set<string>();
  const events = [...(fresh ? live : []), ...(history.data?.items ?? [])].filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  const total =
    (history.data?.total ?? 0) +
    (fresh
      ? live.filter((event) => !history.data?.items.some((item) => item.id === event.id)).length
      : 0);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('events.title')}</h1>
        <label className="flex items-center gap-2 text-sm text-muted">
          {t('events.pageSize')}
          <select
            className={`${selectClasses} w-24`}
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value) as PageSize);
              setPage(1);
            }}
          >
            {EVENTS_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {waiting > 0 ? (
        <Button variant="secondary" className="w-full" onClick={showNewest}>
          {t('events.newArrived', { count: waiting })}
        </Button>
      ) : null}

      {history.isLoading ? (
        <p role="status" className="text-muted">
          {t('common.loading')}
        </p>
      ) : events.length === 0 ? (
        <Card>
          <p className="text-muted">{t('events.empty')}</p>
        </Card>
      ) : null}

      {/* На свежей странице новые события появляются сверху сами: скринридер
          объявляет их, не перечитывая всю ленту. На старых страницах лента не
          меняется, и объявлять нечего. */}
      <ul
        id="events-feed"
        tabIndex={-1}
        className="space-y-2 outline-none"
        aria-label={t('events.feedLabel')}
        aria-live={fresh ? 'polite' : 'off'}
        aria-relevant="additions"
        aria-busy={history.isFetching || undefined}
      >
        {events.map((event) => (
          <li key={event.id}>
            <Card className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate">
                  <span className="font-medium">{event.username}</span>
                  {event.isTest ? (
                    <span className="ml-2 rounded bg-surface-hover px-1.5 py-0.5 text-xs text-muted">
                      {t('events.test')}
                    </span>
                  ) : null}
                  {/* Голосовой донат — без текста: в ленте видно, почему строка пустая. */}
                  {event.audioUrl ? (
                    <span className="ml-2 rounded bg-surface-hover px-1.5 py-0.5 text-xs text-muted">
                      {t('events.voice')}
                    </span>
                  ) : null}
                </p>
                {event.message ? (
                  <p className="truncate text-sm text-muted">{event.message}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                {event.amount ? (
                  <p className="font-medium text-success">{formatMoney(event.amount)}</p>
                ) : event.count !== null ? (
                  <p className="font-medium tabular-nums">
                    {t(`events.count.${event.type}`, {
                      count: event.count,
                      formatted: new Intl.NumberFormat(intlLocale()).format(event.count),
                    })}
                  </p>
                ) : null}
                <time className="block text-xs text-muted tabular-nums" dateTime={event.createdAt}>
                  {eventTime(event.createdAt, today)}
                </time>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPage={goTo}
        labels={{
          nav: t('events.pagination.nav'),
          previous: t('events.pagination.previous'),
          next: t('events.pagination.next'),
          page: (value) => t('events.pagination.page', { page: value }),
          range: (from, to, all) =>
            t('events.pagination.range', {
              from: new Intl.NumberFormat(intlLocale()).format(from),
              to: new Intl.NumberFormat(intlLocale()).format(to),
              total: new Intl.NumberFormat(intlLocale()).format(all),
            }),
        }}
      />
    </div>
  );
}

/**
 * Время события: сегодняшнее — часами, старое — с датой. На второй странице
 * истории одно «14:05» не говорит, какого дня это донат.
 */
function eventTime(iso: string, today: string): string {
  const date = new Date(iso);
  return date.toDateString() === today
    ? date.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' });
}
