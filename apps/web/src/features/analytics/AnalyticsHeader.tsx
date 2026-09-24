import { ANALYTICS_RANGES, type AnalyticsRange } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@streamkit/app-kit';

const TABS = [
  { to: '/analytics', label: 'analytics.tabs.summary', end: true },
  { to: '/analytics/charts', label: 'analytics.tabs.charts', end: false },
] as const;

/**
 * Шапка раздела «Аналитика»: заголовок, вкладки и период.
 *
 * Период — один на обе вкладки и стоит над ними, одной строкой фильтров над
 * всем, что он меняет: переключатель у каждого графика отдельно делал бы
 * сравнение графиков между собой незаметно неверным.
 */
export function AnalyticsHeader({
  range,
  onRangeChange,
}: {
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { search } = useLocation();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('analytics.title')}</h1>
        <RangePicker value={range} onChange={onRangeChange} />
      </div>
      <nav aria-label={t('analytics.tabs.label')}>
        <ul className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border">
          {TABS.map((tab) => (
            <li key={tab.to} className="shrink-0">
              <NavLink
                // Вкладка переносит период с собой: он в адресе.
                to={{ pathname: tab.to, search }}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'block px-3 py-2.5 text-sm whitespace-nowrap',
                    isActive
                      ? 'font-medium text-fg shadow-[inset_0_-2px_0_var(--color-accent)]'
                      : 'text-muted hover:text-fg',
                  )
                }
              >
                {t(tab.label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function RangePicker({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div
      className="flex gap-1 rounded-lg border border-border-strong p-1"
      role="group"
      aria-label={t('analytics.rangeLabel')}
    >
      {ANALYTICS_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={range === value}
          onClick={() => onChange(range)}
          className={cn(
            'rounded px-3 py-1 text-sm',
            range === value ? 'bg-surface-hover font-medium text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {t(`analytics.range.${range}`)}
        </button>
      ))}
    </div>
  );
}
