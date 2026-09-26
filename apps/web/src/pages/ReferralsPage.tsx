import {
  MAX_REFERRAL_ACTIVATION_DAYS,
  REFERRAL_REWARD_DAYS,
  type ReferralOverview,
} from '@streamkit/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Button,
  Card,
  describeField,
  FieldError,
  FieldHint,
  Input,
  Label,
  usePageTitle,
} from '@streamkit/app-kit';
import { useActivateReferralDays, useReferrals } from '@/features/referrals/queries';
import { ApiError } from '@/lib/api';
import { intlLocale } from '@/lib/locale';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(intlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/**
 * Приглашения: свой промокод, накопленные дни «Про» и их включение.
 *
 * Дни не включаются сами: стример копит их к эфиру с гостями или к марафону и
 * решает, на сколько включить. Поэтому главное действие страницы — не
 * «поделиться», а «включить», когда есть что включать.
 */
export function ReferralsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const referrals = useReferrals();
  usePageTitle(t('referrals.title'));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('referrals.title')}</h1>
        <p className="text-sm text-muted">
          {t('referrals.description', {
            multistream: REFERRAL_REWARD_DAYS.multistream,
            pro: REFERRAL_REWARD_DAYS.pro,
          })}
        </p>
      </div>

      {referrals.isLoading ? (
        <p role="status" className="text-muted">
          {t('common.loading')}
        </p>
      ) : null}
      {referrals.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('common.error')}
        </p>
      ) : null}
      {referrals.data ? (
        <>
          <CodeCard code={referrals.data.code} />
          <DaysCard overview={referrals.data} />
          <HistoryCard overview={referrals.data} />
        </>
      ) : null}
    </div>
  );
}

function CodeCard({ code }: { code: string }): React.JSX.Element {
  const { t } = useTranslation();
  const link = `${window.location.origin}/register?ref=${code}`;

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('common.copied'));
    } catch {
      // Clipboard API недоступен без https — код и ссылку выделяют руками.
      toast.error(t('common.error'));
    }
  };

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">{t('referrals.code.title')}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <span
          data-testid="referral-code"
          className="rounded-md border border-border-strong px-3 py-1.5 font-mono text-xl tracking-[0.2em] select-all"
        >
          {code}
        </span>
        <Button variant="secondary" onClick={() => void copy(code)}>
          {t('referrals.code.copyCode')}
        </Button>
      </div>
      <div className="space-y-1">
        <Label htmlFor="referral-link">{t('referrals.code.link')}</Label>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          <Input
            id="referral-link"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            {...describeField('referral-link', { hint: true })}
          />
          <Button variant="secondary" className="shrink-0" onClick={() => void copy(link)}>
            {t('referrals.code.copyLink')}
          </Button>
        </div>
        <FieldHint id="referral-link">{t('referrals.code.linkHint')}</FieldHint>
      </div>
    </Card>
  );
}

function DaysCard({ overview }: { overview: ReferralOverview }): React.JSX.Element {
  const { t } = useTranslation();
  const activate = useActivateReferralDays();
  const available = overview.balanceDays;
  const limit = Math.min(available, MAX_REFERRAL_ACTIVATION_DAYS);
  const [draft, setDraft] = useState('');
  const days = draft === '' ? limit : Number(draft);
  const invalid = !Number.isInteger(days) || days < 1 || days > limit;

  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (invalid) return;
    activate.mutate(days, {
      onSuccess: (result) => {
        setDraft('');
        toast.success(
          t('referrals.days.activated', {
            date: result.proUntil ? formatDate(result.proUntil) : '',
          }),
        );
      },
      onError: (error) =>
        toast.error(error instanceof ApiError ? error.message : t('common.error')),
    });
  };

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">{t('referrals.days.title')}</h2>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">{t('referrals.days.invited')}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{overview.invited}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('referrals.days.paid')}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{overview.paid}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('referrals.days.balance')}</dt>
          <dd data-testid="referral-balance" className="text-2xl font-semibold tabular-nums">
            {available}
          </dd>
        </div>
      </dl>

      {overview.proUntil ? (
        <p data-testid="referral-pro-until" className="text-sm">
          {t('referrals.days.activeUntil', { date: formatDate(overview.proUntil) })}
        </p>
      ) : null}

      {available > 0 ? (
        <form onSubmit={onSubmit} className="space-y-2" noValidate>
          <Label htmlFor="referral-days">{t('referrals.days.amount')}</Label>
          <div className="flex flex-wrap items-start gap-2">
            <Input
              id="referral-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={limit}
              step={1}
              className="w-28"
              placeholder={String(limit)}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              {...describeField('referral-days', {
                hint: true,
                error: invalid ? 'invalid' : undefined,
              })}
            />
            <Button type="submit" disabled={invalid} isLoading={activate.isPending}>
              {invalid
                ? t('referrals.days.submitIdle')
                : t('referrals.days.submit', { count: days })}
            </Button>
          </div>
          <FieldHint id="referral-days">{t('referrals.days.pauseHint')}</FieldHint>
          <FieldError
            id="referral-days"
            message={invalid ? t('referrals.days.range', { max: limit }) : undefined}
          />
        </form>
      ) : (
        <p className="text-sm text-muted">{t('referrals.days.empty')}</p>
      )}
    </Card>
  );
}

function HistoryCard({ overview }: { overview: ReferralOverview }): React.JSX.Element | null {
  const { t } = useTranslation();
  const entries = [
    ...overview.rewards.map((reward) => ({
      id: reward.id,
      at: reward.createdAt,
      text: reward.revoked
        ? t('referrals.history.revoked', { count: reward.days })
        : t('referrals.history.reward', {
            count: reward.days,
            plan: t(`billing.plans.${reward.plan}.name`),
          }),
    })),
    ...overview.activations.map((activation) => ({
      id: activation.id,
      at: activation.startsAt,
      text: t('referrals.history.activation', {
        count: activation.days,
        from: formatDate(activation.startsAt),
        to: formatDate(activation.endsAt),
      }),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (entries.length === 0) return null;
  return (
    <Card className="space-y-3">
      <h2 className="font-medium">{t('referrals.history.title')}</h2>
      <ul className="divide-y divide-border text-sm">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
            <span>{entry.text}</span>
            <span className="text-muted tabular-nums">{formatDate(entry.at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
