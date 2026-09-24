import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@streamkit/app-kit';
import { ChangePasswordCard } from '@/features/auth/ChangePasswordCard';
import { SessionsCard } from '@/features/auth/SessionsCard';
import { TwoFactorCard } from '@/features/auth/TwoFactorCard';

/**
 * Безопасность входа: пароль, второй фактор, устройства.
 *
 * Второй фактор жил в «Приватности» — рядом с согласиями и выгрузкой данных,
 * где его никто не искал. Здесь всё, что решает, кто может войти в аккаунт.
 */
export function SecurityPage(): React.JSX.Element {
  const { t } = useTranslation();
  usePageTitle(t('security.title'));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('security.title')}</h1>
        <p className="text-sm text-muted">{t('security.description')}</p>
      </div>
      <ChangePasswordCard />
      <TwoFactorCard />
      <SessionsCard />
    </div>
  );
}
