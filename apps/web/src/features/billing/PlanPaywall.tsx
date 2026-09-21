import type { PlanFeatures } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '@streamkit/app-kit';
import { useSubscription } from './queries';

/** Возможности тарифа, про которые бывает плашка: да или нет, без чисел. */
type Gate = 'rooms' | 'advancedStyling';

/**
 * Что доступно на тарифе.
 *
 * Пока подписка не загрузилась, доступ считается открытым: кнопки не мигают
 * выключенными у того, кто уже заплатил. Закрытое всё равно проверяет
 * сервер — 402 на создание или вход.
 */
export function usePlanFeatures(): PlanFeatures | null {
  return useSubscription().data?.features ?? null;
}

export function usePlanAccess(gate: Gate): boolean {
  return usePlanFeatures()?.[gate] ?? true;
}

/**
 * Плашка «нужен другой тариф».
 *
 * Называет тариф, который открывает функцию, а не просто «оформите подписку»:
 * тарифов больше одного, и «Мультистрим» комнат не открывает. Текст берётся по
 * имени функции — так плашку можно поставить рядом с любой из них, не заводя
 * ещё один компонент.
 */
export function PlanPaywall({ gate }: { gate: Gate }): React.JSX.Element | null {
  const { t } = useTranslation();
  const subscription = useSubscription();
  if (!subscription.data || subscription.data.features[gate]) return null;

  const expired = subscription.data.status === 'expired';
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 p-4"
    >
      <div className="space-y-1">
        <p className="font-medium">
          {expired ? t(`billing.paywall.${gate}.expired`) : t(`billing.paywall.${gate}.title`)}
        </p>
        <p className="max-w-2xl text-sm text-muted">{t(`billing.paywall.${gate}.hint`)}</p>
      </div>
      <ButtonLink to="/billing">{t('billing.paywall.action')}</ButtonLink>
    </div>
  );
}
