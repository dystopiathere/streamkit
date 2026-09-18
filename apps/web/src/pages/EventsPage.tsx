import { type AlertEvent, SOCKET_EVENTS, alertEventSchema } from '@streamkit/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, usePageTitle } from '@streamkit/app-kit';
import { useRecentEvents } from '@/features/widgets/queries';
import { useDashboardSocket } from '@/lib/useDashboardSocket';
import { formatMoney, intlLocale } from '@/lib/locale';

/** Сколько живых событий держим в памяти. Остальное есть в истории. */
const LIVE_BUFFER = 50;

/**
 * Лента событий. История подтягивается запросом, новые события приходят сокетом —
 * без этого стример не понимает, дошёл ли донат, пока не обновит страницу.
 */
export function EventsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const history = useRecentEvents();
  const queryClient = useQueryClient();
  const [live, setLive] = useState<AlertEvent[]>([]);
  usePageTitle(t('events.title'));

  useDashboardSocket(
    SOCKET_EVENTS.eventCreated,
    useCallback(
      (payload: unknown) => {
        const parsed = alertEventSchema.safeParse((payload as { event?: unknown })?.event);
        if (!parsed.success) return;

        setLive((current) => [parsed.data, ...current].slice(0, LIVE_BUFFER));
        // История в кэше устарела — пусть перезапросится при следующем заходе.
        void queryClient.invalidateQueries({ queryKey: ['events'] });
      },
      [queryClient],
    ),
  );

  // Живые события идут первыми; дубли отсекаем по id, потому что после
  // инвалидации то же событие придёт и из истории.
  const seen = new Set<string>();
  const events = [...live, ...(history.data?.items ?? [])].filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('events.title')}</h1>

      {events.length === 0 ? (
        <Card>
          <p className="text-muted">{t('events.empty')}</p>
        </Card>
      ) : null}

      {/* Новые события появляются сверху сами: скринридер объявляет их, не
          перечитывая всю ленту. */}
      <ul
        className="space-y-2"
        aria-label={t('events.feedLabel')}
        aria-live="polite"
        aria-relevant="additions"
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
                </p>
                {event.message ? (
                  <p className="truncate text-sm text-muted">{event.message}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                {event.amount ? (
                  <p className="font-medium text-success">{formatMoney(event.amount)}</p>
                ) : null}
                <p className="text-xs text-muted">
                  {new Date(event.createdAt).toLocaleTimeString(intlLocale())}
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
