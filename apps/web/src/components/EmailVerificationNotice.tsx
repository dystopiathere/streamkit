import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@streamkit/app-kit';
import { useEmailVerificationSync, useResendVerification } from '@/features/auth/queries';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth-store';

/**
 * Плашка «подтвердите почту» над каждой страницей дашборда.
 *
 * Без кнопки «позже»: пока почта не подтверждена, не приходят письма о входе
 * с нового устройства и о списаниях и закрыта оплата — человек должен видеть
 * причину там, где столкнётся со следствием, а не искать её в профиле.
 */
export function EmailVerificationNotice(): React.JSX.Element | null {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const resend = useResendVerification();
  useEmailVerificationSync();

  if (!user || user.emailVerified) return null;

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-border-strong bg-surface-hover px-4 py-3 text-sm"
    >
      <p className="min-w-0 max-w-3xl">{t('emailVerification.notice', { email: user.email })}</p>
      <Button
        variant="secondary"
        isLoading={resend.isPending}
        onClick={() =>
          resend.mutate(undefined, {
            onSuccess: () => toast.success(t('emailVerification.resent', { email: user.email })),
            onError: (error) =>
              toast.error(error instanceof ApiError ? error.message : t('common.error')),
          })
        }
      >
        {t('emailVerification.resend')}
      </Button>
    </div>
  );
}
