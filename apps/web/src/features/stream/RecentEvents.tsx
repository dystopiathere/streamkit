import type { AlertEvent } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@streamkit/app-kit';
import { formatMoney, intlLocale } from '@/lib/locale';

/**
 * Вес доната — размером по фиксированной шкале, а не цветом.
 *
 * Крупный донат должен выделяться в ленте с одного взгляда, но цвет в этом мире
 * — метка, а не смысл: зелёная сумма у каждой строки ничего не выделяет. Шкала
 * постоянная, в минорных единицах любой валюты: она про заметность строки, а
 * не про деньги, и пересчёта курса не требует.
 */
function weightClass(amountMinor: number): string {
  if (amountMinor >= 500_000) return 'text-lg';
  if (amountMinor >= 100_000) return 'text-base';
  return 'text-sm';
}

/** Последние события в окне эфира: коротко, без сообщений — их читают в ленте. */
export function RecentEvents({ events }: { events: AlertEvent[] }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="stream-events-title"
      className="rounded-card border border-border bg-surface"
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id="stream-events-title" className="font-medium">
          {t('stream.events.title')}
        </h2>
        <Link to="/events" className="text-xs text-muted hover:text-fg">
          {t('stream.events.all')}
        </Link>
      </header>
      {events.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">{t('events.empty')}</p>
      ) : (
        // Новые события объявляются: их, в отличие от чата, единицы в минуту,
        // и донат — ровно то, что стример хочет услышать.
        <ul aria-live="polite" aria-relevant="additions" className="divide-y divide-border text-sm">
          {events.map((event) => (
            <li key={event.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <p className="min-w-0 truncate">
                <span className="font-medium">{event.username}</span>
                {event.type !== 'donation' ? (
                  <span className="ml-2 text-xs text-muted">{t(`events.type.${event.type}`)}</span>
                ) : null}
                {event.isTest ? (
                  <span className="ml-2 rounded bg-surface-hover px-1.5 py-0.5 text-xs text-muted">
                    {t('events.test')}
                  </span>
                ) : null}
              </p>
              <div className="shrink-0 text-right">
                {event.amount ? (
                  <p
                    className={cn(
                      'font-medium tabular-nums',
                      weightClass(event.amount.amountMinor),
                    )}
                  >
                    {formatMoney(event.amount)}
                  </p>
                ) : event.count !== null ? (
                  <p className="font-medium tabular-nums">
                    {t(`events.count.${event.type}`, {
                      count: event.count,
                      formatted: new Intl.NumberFormat(intlLocale()).format(event.count),
                    })}
                  </p>
                ) : null}
                <p className="text-xs text-muted tabular-nums">
                  {new Date(event.createdAt).toLocaleTimeString(intlLocale(), {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
