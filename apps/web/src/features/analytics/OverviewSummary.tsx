import {
  type AnalyticsOverview,
  compareStreamDays,
  type Currency,
  donationsPerLiveHour,
  type StreamSession,
} from '@streamkit/contracts';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Card, type Column, DataTable } from '@streamkit/app-kit';
import { formatMoney, intlLocale } from '@/lib/locale';
import { formatNumber } from './chart-kit';

/** «2 ч 15 мин» — длительность эфира словами, без дробных часов. */
export function formatDuration(t: TFunction, minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('analytics.duration.minutes', { minutes: rest });
  if (rest === 0) return t('analytics.duration.hours', { hours });
  return t('analytics.duration.hoursMinutes', { hours, minutes: rest });
}

export const money = (amountMinor: number, currency: Currency): string =>
  formatMoney({ amountMinor, currency });

/** Прирост со знаком: «+12», «−3». Ноль — без знака. */
export function formatGain(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;
}

/**
 * Итоги периода плитками: донаты, эфиры, цена часа эфира, аудитория.
 *
 * Плитка — одно число с подписью: это ответ на «сколько», графики отвечают
 * на «когда» и «от чего». Числа без `tabular-nums`: у крупного числа в
 * одиночестве равноширинные цифры выглядят разреженными.
 */
export function OverviewStats({ overview }: { overview: AnalyticsOverview }): React.JSX.Element {
  const { t } = useTranslation();
  const { streams, currency } = overview;
  const primary = overview.donationTotals.find((total) => total.currency === currency);
  const others = overview.donationTotals.filter((total) => total.currency !== currency);
  const liveMinutes = streams.reduce((sum, stream) => sum + stream.minutes, 0);
  const perHour = donationsPerLiveHour(streams);
  const knownGains = overview.buckets.filter((bucket) => bucket.audienceGain !== null);
  const audience =
    knownGains.length === 0
      ? null
      : knownGains.reduce((sum, bucket) => sum + bucket.audienceGain!, 0);
  // Доля — отношение двух сумм, а не сумма: дробь здесь только для процента.
  const liveShare =
    primary && primary.amountMinor > 0
      ? Math.round((overview.donationsDuringStreamsMinor / primary.amountMinor) * 100)
      : null;

  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        label={t('analytics.stats.donations')}
        value={money(primary?.amountMinor ?? 0, currency)}
        note={
          <>
            {t('analytics.donationsCount', { count: primary?.count ?? 0 })}
            {others.map((total) => (
              <span key={total.currency} className="block">
                + {money(total.amountMinor, total.currency)}
              </span>
            ))}
          </>
        }
      />
      <Tile
        label={t('analytics.stats.streams')}
        value={formatNumber(streams.length)}
        note={liveMinutes > 0 ? formatDuration(t, liveMinutes) : t('analytics.stats.noStreams')}
      />
      <Tile
        label={t('analytics.stats.averageStream')}
        value={
          streams.length > 0 ? formatDuration(t, Math.round(liveMinutes / streams.length)) : null
        }
      />
      <Tile
        label={t('analytics.stats.perLiveHour')}
        value={perHour === null ? null : money(perHour, currency)}
        note={t('analytics.stats.perLiveHourNote')}
      />
      <Tile
        label={t('analytics.stats.liveShare')}
        value={liveShare === null ? null : `${liveShare} %`}
        note={t('analytics.stats.liveShareNote')}
      />
      <Tile
        label={t('analytics.stats.audience')}
        value={audience === null ? null : formatGain(audience)}
        note={t('analytics.stats.audienceNote')}
      />
    </dl>
  );
}

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string | null;
  note?: React.ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Card className="px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">
        {value ?? (
          <span className="text-muted">
            <span aria-hidden="true">{t('analytics.noValue')}</span>
            <span className="sr-only">{t('common.noData')}</span>
          </span>
        )}
      </dd>
      {note ? <dd className="mt-1 text-xs text-muted">{note}</dd> : null}
    </Card>
  );
}

/**
 * Дни с эфиром против дней без — самый прямой ответ на «эфир окупается?».
 *
 * Только для суточных корзин: у суток по часам вопрос «был ли эфир в этот
 * день» не имеет смысла. Во сколько раз — словом, только когда обе стороны
 * есть и больше нуля: «в бесконечность раз» и «в 0 раз» ничего не говорят.
 */
export function StreamDaysCard({
  overview,
}: {
  overview: AnalyticsOverview;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (overview.bucket !== 'day') return null;
  const days = compareStreamDays(overview.buckets);
  if (days.streamDays === 0 || days.offDays === 0) {
    return (
      <Card className="space-y-2">
        <h2 className="font-medium">{t('analytics.days.title')}</h2>
        <p className="text-sm text-muted">
          {days.streamDays === 0 ? t('analytics.days.noStreamDays') : t('analytics.days.noOffDays')}
        </p>
      </Card>
    );
  }

  const ratio =
    days.donationsPerStreamDay && days.donationsPerOffDay
      ? days.donationsPerStreamDay / days.donationsPerOffDay
      : null;
  const ratioText =
    ratio === null
      ? null
      : new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(
          ratio >= 1 ? ratio : 1 / ratio,
        );

  const rows = [
    {
      label: t('analytics.days.withStream', { count: days.streamDays }),
      donations: days.donationsPerStreamDay,
      audience: days.audiencePerStreamDay,
    },
    {
      label: t('analytics.days.withoutStream', { count: days.offDays }),
      donations: days.donationsPerOffDay,
      audience: days.audiencePerOffDay,
    },
  ];

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">{t('analytics.days.title')}</h2>
      {ratio !== null && ratioText !== null ? (
        <p className="text-sm">
          {ratio >= 1
            ? t('analytics.days.moreOnStreamDays', { ratio: ratioText })
            : t('analytics.days.moreOnOffDays', { ratio: ratioText })}
        </p>
      ) : null}
      <table className="w-full text-sm">
        <caption className="sr-only">{t('analytics.days.title')}</caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1 font-normal">
              {t('analytics.days.kind')}
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              {t('analytics.days.donationsPerDay')}
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              {t('analytics.days.audiencePerDay')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border">
              <th scope="row" className="py-2 text-left font-normal">
                {row.label}
              </th>
              <td className="py-2 text-right tabular-nums">
                {row.donations === null
                  ? t('analytics.noValue')
                  : money(row.donations, overview.currency)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {row.audience === null ? t('analytics.noValue') : formatGain(row.audience)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * Эфиры периода — таблицей, новые сверху.
 *
 * Это и самостоятельный ответ («какой эфир был лучшим»), и табличный двойник
 * точечных графиков связи на вкладке «Графики»: те же эфиры, те же числа.
 */
export function StreamsTable({ overview }: { overview: AnalyticsOverview }): React.JSX.Element {
  const { t } = useTranslation();
  const rows = [...overview.streams].reverse();
  const na = t('analytics.noValue');
  const columns: Array<Column<StreamSession>> = [
    {
      key: 'date',
      header: t('analytics.streams.date'),
      cell: (row) =>
        new Date(row.startedAt).toLocaleString(intlLocale(), {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    {
      key: 'duration',
      header: t('analytics.streams.duration'),
      cell: (row) => formatDuration(t, row.minutes),
    },
    {
      key: 'platforms',
      header: t('analytics.streams.platforms'),
      cell: (row) =>
        row.platforms.map((platform) => t(`analytics.platform.${platform}`)).join(', '),
    },
    {
      key: 'peak',
      header: t('analytics.streams.peak'),
      align: 'end',
      cell: (row) => (row.peakViewers === null ? na : formatNumber(row.peakViewers)),
    },
    {
      key: 'avg',
      header: t('analytics.streams.average'),
      align: 'end',
      cell: (row) => (row.avgViewers === null ? na : formatNumber(row.avgViewers)),
    },
    {
      key: 'donations',
      header: t('analytics.streams.donations'),
      align: 'end',
      cell: (row) => money(row.donationsMinor, overview.currency),
    },
    {
      key: 'audience',
      header: t('analytics.streams.audience'),
      align: 'end',
      cell: (row) => (row.audienceGain === null ? na : formatGain(row.audienceGain)),
    },
    {
      key: 'events',
      header: t('analytics.streams.events'),
      align: 'end',
      cell: (row) => formatNumber(row.events),
    },
  ];

  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-medium">{t('analytics.streams.title')}</h2>
        <p className="text-sm text-muted">{t('analytics.streams.description')}</p>
      </div>
      <DataTable
        caption={t('analytics.streams.title')}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(row) => row.startedAt}
        empty={<p className="text-sm text-muted">{t('analytics.streams.empty')}</p>}
      />
    </Card>
  );
}
