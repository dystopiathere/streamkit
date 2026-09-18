import type { StreamWidget } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { StatusPill } from '@streamkit/app-kit';

/**
 * Виджеты и их связь с OBS прямо сейчас.
 *
 * «В OBS» — оверлей по ссылке открыт в эту минуту; это и есть вопрос, который
 * стример задаёт перед эфиром: «алерты вообще на экране?». Сначала подключённые,
 * потом включённые, выключенные — в конце.
 */
export function StreamWidgets({ widgets }: { widgets: StreamWidget[] }): React.JSX.Element {
  const { t } = useTranslation();
  const sorted = [...widgets].sort((a, b) => rank(a) - rank(b));

  return (
    <section
      aria-labelledby="stream-widgets-title"
      className="rounded-card border border-border bg-surface"
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id="stream-widgets-title" className="font-medium">
          {t('stream.widgets.title')}
        </h2>
        <Link to="/widgets" className="text-xs text-muted hover:text-fg">
          {t('stream.widgets.all')}
        </Link>
      </header>
      {sorted.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">{t('widgets.empty')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {sorted.map((widget) => (
            <li key={widget.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0">
                <Link
                  to={`/widgets/${widget.id}`}
                  className="block truncate font-medium hover:underline"
                >
                  {widget.name}
                </Link>
                <p className="text-xs text-muted">{t(`widgets.type.${widget.type}`)}</p>
              </div>
              <WidgetState widget={widget} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WidgetState({ widget }: { widget: StreamWidget }): React.JSX.Element {
  const { t } = useTranslation();
  if (!widget.isEnabled) return <StatusPill>{t('stream.widgets.disabled')}</StatusPill>;
  if (widget.connected > 0) {
    return (
      <StatusPill tone="success">
        {widget.connected > 1
          ? t('stream.widgets.inObsCount', { count: widget.connected })
          : t('stream.widgets.inObs')}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="warning">
      {widget.links === 0 ? t('stream.widgets.noLinks') : t('stream.widgets.notConnected')}
    </StatusPill>
  );
}

function rank(widget: StreamWidget): number {
  if (!widget.isEnabled) return 3;
  if (widget.connected > 0) return 0;
  return widget.links > 0 ? 1 : 2;
}
