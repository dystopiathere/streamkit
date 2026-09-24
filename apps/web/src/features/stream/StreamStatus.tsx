import { type StreamChannel, streamStartedAt, totalViewers } from '@streamkit/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn, StatusPill } from '@streamkit/app-kit';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { intlLocale } from '@/lib/locale';
import { StreamClock } from './StreamClock';
import { PLATFORMS_PATH } from '@/components/navigation';

/**
 * Состояние эфира: идёт ли, сколько идёт, сколько зрителей всего и на каждой
 * площадке.
 *
 * Крупные числа здесь — суть окна: на них смотрят между делом, во время игры,
 * и считывать их надо за полсекунды. Идёт ли эфир — словом, не только цветом.
 */
export function StreamStatus({
  channels,
  compact = false,
}: {
  channels: StreamChannel[];
  compact?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const startedAt = streamStartedAt(channels);
  const viewers = totalViewers(channels);
  const isLive = channels.some((channel) => channel.isLive);
  const number = new Intl.NumberFormat(intlLocale());
  const delta = useChange(viewers);

  if (channels.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border-strong px-4 py-3 text-sm text-muted">
        {t('stream.noPlatforms')}{' '}
        <Link to={PLATFORMS_PATH} className="underline hover:text-fg">
          {t('stream.connectPlatform')}
        </Link>
      </p>
    );
  }

  return (
    <section
      aria-label={t('stream.statusLabel')}
      className="rounded-card border border-border bg-surface"
    >
      <dl className={cn('grid grid-cols-2 gap-px', !compact && 'sm:grid-cols-[auto_auto_1fr]')}>
        <div className="px-4 py-3">
          <dt className="flex items-center gap-2 text-xs text-muted">
            {t('stream.duration')}
            <StatusPill tone={isLive ? 'success' : 'neutral'}>
              {isLive ? t('stream.live') : t('stream.offline')}
            </StatusPill>
          </dt>
          <dd className={cn('mt-1 font-semibold tabular-nums', compact ? 'text-2xl' : 'text-3xl')}>
            {startedAt ? <StreamClock startedAt={startedAt} /> : t('analytics.noValue')}
          </dd>
        </div>

        <div className="px-4 py-3">
          <dt className="text-xs text-muted">{t('stream.viewersTotal')}</dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <span className={cn('font-semibold tabular-nums', compact ? 'text-2xl' : 'text-3xl')}>
              {viewers === null ? t('analytics.noValue') : number.format(viewers)}
            </span>
            {/* Число без направления не отвечает на вопрос, который задают
                между делом: эфир набирает или теряет? Изменение — с прошлого
                замера этого окна; истории замеров у окна нет, и честнее так и
                сказать, чем рисовать тренд за час. */}
            {delta ? (
              <span
                // Ахроматично: направление — знаком и стрелкой, цвет в этом мире
                // только у меток. Зелёный рост читался бы как статус «успех».
                className={cn(
                  'inline-flex items-center gap-0.5 text-sm font-medium tabular-nums',
                  delta > 0 ? 'text-fg' : 'text-muted',
                )}
                title={t('stream.deltaHint')}
              >
                {delta > 0 ? (
                  <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {delta > 0 ? '+' : '−'}
                {number.format(Math.abs(delta))}
                <span className="sr-only"> {t('stream.deltaHint')}</span>
              </span>
            ) : null}
          </dd>
        </div>

        <div
          className={cn(
            'col-span-2 border-t border-border px-4 py-3',
            !compact && 'sm:col-span-1 sm:border-t-0 sm:border-l',
          )}
        >
          <dt className="sr-only">{t('stream.platforms')}</dt>
          <dd>
            <ul className="space-y-1.5 text-sm">
              {channels.map((channel) => (
                <li key={channel.id} className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-medium">
                    {t(`analytics.platform.${channel.platform}`)}
                  </span>
                  {channel.isLive ? (
                    <span className="shrink-0 tabular-nums">
                      {channel.viewers === null
                        ? t('stream.liveNoViewers')
                        : t('stream.viewers', {
                            count: channel.viewers,
                            formatted: number.format(channel.viewers),
                          })}
                    </span>
                  ) : (
                    <span className="shrink-0 text-muted">{t('stream.platformOffline')}</span>
                  )}
                  {channel.syncState !== 'ok' ? (
                    <Link
                      to={PLATFORMS_PATH}
                      className="shrink-0 text-xs text-warning hover:underline"
                    >
                      {t('stream.syncProblem')}
                    </Link>
                  ) : channel.title ? (
                    <span className="min-w-0 truncate text-xs text-muted">{channel.title}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * На сколько значение изменилось с прошлого замера.
 *
 * Прошлое значение живёт в состоянии и подстраивается в рендере, а не в эффекте:
 * так React советует подстраивать состояние под изменившийся пропс. Ноль и
 * отсутствие данных — не изменение, и подписи рядом с числом нет.
 */
function useChange(value: number | null): number | null {
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState<number | null>(null);
  if (value !== current) {
    setPrevious(current);
    setCurrent(value);
  }
  if (value === null || previous === null || value === previous) return null;
  return value - previous;
}
