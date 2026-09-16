import { useTranslation } from 'react-i18next';
import { ButtonLink } from '@/components/ui';
import { useSubscription } from './queries';

/**
 * Доступны ли приватные комнаты — и плашка, если нет.
 *
 * Пока подписка не загрузилась, доступ считается открытым: кнопки не мигают
 * выключенными у того, кто уже заплатил. Закрытый доступ всё равно проверяет
 * сервер — ответ 402 на создание или вход.
 */
export function useRoomsAccess(): boolean {
  const subscription = useSubscription();
  return subscription.data?.roomsAccess ?? true;
}

export function RoomsPaywall(): React.JSX.Element | null {
  const { t } = useTranslation();
  const subscription = useSubscription();
  if (!subscription.data || subscription.data.roomsAccess) return null;

  const expired = subscription.data.status === 'expired';
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 p-4"
    >
      <div className="space-y-1">
        <p className="font-medium">
          {expired ? t('billing.paywall.expiredTitle') : t('billing.paywall.title')}
        </p>
        <p className="max-w-2xl text-sm text-muted">{t('billing.paywall.hint')}</p>
      </div>
      <ButtonLink to="/billing">{t('billing.paywall.action')}</ButtonLink>
    </div>
  );
}
