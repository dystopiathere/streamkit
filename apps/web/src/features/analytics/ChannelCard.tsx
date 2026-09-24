import {
  type AnalyticsRange,
  type Channel,
  type ChannelCounter,
  PLATFORM_COUNTERS,
} from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, StatusPill } from '@streamkit/app-kit';
import { PLATFORMS_PATH } from '@/components/navigation';
import { intlLocale } from '@/lib/locale';
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

  return (
    <Card className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        {channel.avatarUrl ? (
          <img
            src={channel.avatarUrl}
            alt=""
            className="h-10 w-10 rounded-full border border-border"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{channel.displayName}</span>
            {current?.isLive ? (
              // Состояние передаётся формой и текстом, а не только цветом.
              <StatusPill tone="danger">{t('analytics.live')}</StatusPill>
            ) : null}
          </h2>
          <p className="truncate text-xs text-muted">
            {t(`analytics.platform.${channel.platform}`)} · {channel.login}
          </p>
        </div>
      </header>

      {needsAttention ? (
        // Здесь только отметка и дорога: чинят площадку в профиле, где есть
        // кнопки, а не в двух местах сразу.
        <p className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-muted">
          {channel.isEnabled ? t('analytics.channelNeedsAction') : t('analytics.channelInactive')}{' '}
          <Link to={PLATFORMS_PATH} className="underline hover:text-fg">
            {t('nav.platforms')}
          </Link>
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label={t('analytics.viewersNow')}
          value={current?.isLive ? current.viewers : null}
          missing={current && !current.isLive ? t('analytics.offline') : undefined}
        />
        {visible.map((counter) => (
          <Stat
            key={counter}
            label={t(`analytics.counter.${counter}`)}
            value={current?.[counter] ?? null}
            delta={summary.data?.deltas[counter] ?? null}
            hint={counterHint(channel, counter, t)}
          />
        ))}
        <Stat label={t('analytics.peakViewers')} value={summary.data?.peakViewers ?? null} />
        <Stat
          label={t('analytics.liveHours')}
          value={summary.data?.liveHours ?? null}
          suffix={t('analytics.hoursSuffix')}
        />
      </dl>
    </Card>
  );
}

/** YouTube округляет подписчиков в самом API — об этом нужно сказать у числа. */
function counterHint(
  channel: Channel,
  counter: ChannelCounter,
  t: (key: string) => string,
): string | undefined {
  return channel.platform === 'youtube' && counter === 'subscribers'
    ? t('analytics.youtubeRounding')
    : undefined;
}

interface StatProps {
  label: string;
  value: number | null;
  delta?: number | null;
  suffix?: string;
  /** Что написать вместо прочерка, когда значения нет по понятной причине. */
  missing?: string;
  hint?: string;
}

function Stat({ label, value, delta, suffix, missing, hint }: StatProps): React.JSX.Element {
  const { t } = useTranslation();
  const format = (number: number): string => new Intl.NumberFormat(intlLocale()).format(number);

  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold sm:text-xl">
        {value === null ? (
          missing ? (
            <span className="text-sm font-normal text-muted">{missing}</span>
          ) : (
            // Прочерк, а не ноль: «неизвестно» и «ноль» — разные утверждения.
            <span className="text-muted">
              <span aria-hidden="true">{t('analytics.noValue')}</span>
              <span className="sr-only">{t('common.noData')}</span>
            </span>
          )
        ) : (
          <>
            {format(value)}
            {suffix ? <span className="ml-1 text-sm font-normal text-muted">{suffix}</span> : null}
          </>
        )}
      </dd>
      {delta !== undefined && delta !== null && delta !== 0 ? (
        // Тренд ахроматичен: рост светлее, падение приглушённее, знак — словом.
        <dd className={delta > 0 ? 'text-xs text-fg' : 'text-xs text-muted'}>
          {delta > 0 ? '+' : '−'}
          {format(Math.abs(delta))}
          <span className="sr-only"> {t('analytics.deltaForPeriod')}</span>
        </dd>
      ) : null}
      {hint ? <dd className="mt-1 text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}
