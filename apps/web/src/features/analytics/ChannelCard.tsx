import { type AnalyticsRange, type Channel, PLATFORM_COUNTERS } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, StatusPill } from '@streamkit/app-kit';
import { PLATFORMS_PATH } from '@/components/navigation';
import { intlLocale } from '@/lib/locale';
import { formatDuration, formatGain } from './OverviewSummary';
import { useChannelSummary } from './queries';

interface ChannelCardProps {
  channel: Channel;
  range: AnalyticsRange;
}

/**
 * Показатели канала за период — без графиков и без управления.
 *
 * Графики — на вкладке «Графики», подключение и отключение — в профиле. Здесь
 * только то, что площадка действительно сообщает (`PLATFORM_COUNTERS`): у
 * YouTube нет фолловеров, у Twitch — суммарных просмотров, и прочерк на их
 * месте выглядел как сбой сбора, которого нет.
 *
 * Эфир — состояние канала, а не число: он стоит плашкой в шапке, а плитка
 * зрителей появляется только в эфире. Плиткой «Зрителей: не в эфире» слова
 * в узкой клетке ломались по строкам и читались как значение.
 */
export function ChannelCard({ channel, range }: ChannelCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const summary = useChannelSummary(channel.id, range);
  const current = summary.data?.current ?? null;
  const counters = PLATFORM_COUNTERS[channel.platform];
  const visible = counters.counters.filter(
    (counter) => !counters.optional.includes(counter) || (current?.[counter] ?? null) !== null,
  );
  const needsAttention = !channel.isEnabled || channel.syncState !== 'ok' || channel.needsReconnect;
  const liveMinutes = Math.round((summary.data?.liveHours ?? 0) * 60);
  const hadStreams = liveMinutes > 0 || (summary.data?.peakViewers ?? null) !== null;

  return (
    <Card className="space-y-4">
      <header className="flex items-center gap-3">
        {channel.avatarUrl ? (
          <img
            src={channel.avatarUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full border border-border"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{channel.displayName}</h2>
          <p className="truncate text-xs text-muted">
            {t(`analytics.platform.${channel.platform}`)} · {channel.login}
          </p>
        </div>
        {current ? (
          // Состояние передаётся словом в рамке, а не только цветом.
          <StatusPill tone={current.isLive ? 'danger' : 'neutral'}>
            {current.isLive ? t('analytics.live') : t('analytics.offline')}
          </StatusPill>
        ) : null}
      </header>

      {needsAttention ? (
        // Здесь только отметка и дорога: чинят площадку в профиле, где есть
        // кнопки, а не в двух местах сразу.
        <p className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-muted">
          {channel.isEnabled ? t('analytics.channelNeedsAction') : t('analytics.channelInactive')}{' '}
          <Link to={PLATFORMS_PATH} className="underline hover:text-fg">
            {t('analytics.fixInProfile')}
          </Link>
        </p>
      ) : null}

      {/* Колонки по ширине карточки, а не экрана: на широком экране карточки
          стоят по две, и пять колонок по экрану сжимали клетку до пары слов. */}
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
        {current?.isLive ? (
          <Stat label={t('analytics.viewersNow')} value={formatNullable(current.viewers)} />
        ) : null}
        {visible.map((counter) => (
          <Stat
            key={counter}
            label={t(`analytics.counter.${counter}`)}
            value={formatNullable(current?.[counter] ?? null)}
            delta={summary.data?.deltas[counter] ?? null}
          />
        ))}
        {hadStreams ? (
          <>
            <Stat
              label={t('analytics.peakViewers')}
              value={formatNullable(summary.data?.peakViewers ?? null)}
            />
            <Stat label={t('analytics.liveTime')} value={formatDuration(t, liveMinutes)} />
          </>
        ) : null}
      </dl>

      {summary.data && !hadStreams ? (
        // Одна строка вместо двух плиток «эфиров не было»: нуль эфиров —
        // это факт о периоде, а не два разных показателя.
        <p className="text-sm text-muted">{t('analytics.noLiveData')}</p>
      ) : null}
    </Card>
  );
}

const formatCount = (number: number): string => new Intl.NumberFormat(intlLocale()).format(number);

const formatNullable = (number: number | null): string | null =>
  number === null ? null : formatCount(number);

interface StatProps {
  label: string;
  value: string | null;
  delta?: number | null;
}

/**
 * Плитка показателя: подпись, число и изменение за период.
 *
 * Число — без `tabular-nums`: у одиночного крупного числа равноширинные цифры
 * выглядят разреженными. Изменение подписано словом рядом, а не только для
 * диктора: «+3» без «за период» непонятно, с чем сравнивали.
 */
function Stat({ label, value, delta }: StatProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="min-w-0 rounded-lg border border-border px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-xl leading-tight font-semibold">
        {value !== null ? (
          value
        ) : (
          // Прочерк, а не ноль: «неизвестно» и «ноль» — разные утверждения.
          <span className="text-muted">
            <span aria-hidden="true">{t('analytics.noValue')}</span>
            <span className="sr-only">{t('common.noData')}</span>
          </span>
        )}
      </dd>
      {delta !== undefined && delta !== null && delta !== 0 ? (
        // Тренд ахроматичен: рост светлее, падение приглушённее, знак — символом.
        <dd className={delta > 0 ? 'mt-0.5 text-xs text-fg' : 'mt-0.5 text-xs text-muted'}>
          {formatGain(delta)} {t('analytics.deltaForPeriod')}
        </dd>
      ) : null}
    </div>
  );
}
