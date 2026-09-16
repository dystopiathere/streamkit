import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { usePageTitle } from '@/components/header';
import { Button, Card, Input, Label, NewTabHint } from '@/components/ui';
import { useConsents, useGrantConsent, useRevokeConsent } from '@/features/privacy/queries';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Страница управления данными: что о пользователе хранится, какие согласия даны,
 * как выгрузить данные и как удалить учётную запись.
 *
 * 152-ФЗ требует не просто наличия такой возможности, но и её доступности —
 * поэтому это обычный раздел меню, а не форма обращения в поддержку.
 */
export function PrivacyPage(): React.JSX.Element {
  const { t } = useTranslation();
  const clearSession = useAuthStore((state) => state.clearSession);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');

  const consents = useConsents();
  const grant = useGrantConsent();
  const revoke = useRevokeConsent();
  usePageTitle(t('privacy.title'));

  const deleteAccount = useMutation({
    mutationFn: () => api.delete<void>('/privacy/account', { confirmation: 'УДАЛИТЬ', password }),
    onSuccess: () => {
      clearSession();
      window.location.href = '/login';
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    },
  });

  const handleExport = async (): Promise<void> => {
    const data = await api.get<Record<string, unknown>>('/privacy/export');
    // Формируем файл на клиенте: выгрузка содержит ПДн, и промежуточная ссылка
    // на сервере была бы лишним местом, где эти данные могут утечь.
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `streamkit-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('privacy.title')}</h1>

      <Card className="space-y-4">
        <h2 className="font-medium">{t('privacy.consents')}</h2>

        <ul className="space-y-3">
          {consents.data?.map((consent) => (
            <li
              key={consent.document}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 text-sm"
            >
              <div>
                <a href={consent.path} target="_blank" rel="noreferrer" className="underline">
                  {consent.title}
                  <NewTabHint />
                </a>
                <p className="text-xs text-muted">
                  {consent.acceptedAt
                    ? t('privacy.accepted', {
                        date: new Date(consent.acceptedAt).toLocaleDateString('ru-RU'),
                      })
                    : t('privacy.notAccepted')}
                </p>
                {consent.needsRenewal ? (
                  <p className="text-xs text-danger">{t('privacy.needsRenewal')}</p>
                ) : null}
              </div>

              {consent.acceptedVersion && !consent.needsRenewal ? (
                consent.required ? null : (
                  <Button
                    variant="ghost"
                    aria-label={t('privacy.revokeNamed', { name: consent.title })}
                    onClick={() =>
                      revoke.mutate(consent.document, {
                        onError: (error) =>
                          toast.error(
                            error instanceof ApiError ? error.message : t('common.error'),
                          ),
                      })
                    }
                  >
                    {t('privacy.revoke')}
                  </Button>
                )
              ) : consent.acceptedAtCheckout ? null : (
                <Button
                  variant="secondary"
                  aria-label={t(
                    consent.needsRenewal ? 'privacy.renewNamed' : 'privacy.grantNamed',
                    {
                      name: consent.title,
                    },
                  )}
                  onClick={() => grant.mutate(consent.document)}
                >
                  {consent.needsRenewal ? t('privacy.renew') : t('privacy.grant')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-medium">{t('privacy.export')}</h2>
        <p className="text-sm text-muted">{t('privacy.exportDescription')}</p>
        <Button variant="secondary" onClick={handleExport}>
          {t('privacy.export')}
        </Button>
      </Card>

      <Card className="space-y-3 border-danger/40">
        <h2 className="font-medium text-danger">{t('privacy.deleteTitle')}</h2>
        <p className="text-sm text-muted">{t('privacy.deleteDescription')}</p>

        <div className="max-w-xs">
          <Label htmlFor="confirmation">{t('privacy.deleteConfirmLabel')}</Label>
          <Input
            id="confirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>

        <div className="max-w-xs">
          <Label htmlFor="delete-password">{t('privacy.deletePasswordLabel')}</Label>
          <Input
            id="delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <Button
          variant="danger"
          disabled={confirmation !== 'УДАЛИТЬ' || password.length === 0}
          isLoading={deleteAccount.isPending}
          onClick={() => deleteAccount.mutate()}
        >
          {t('privacy.deleteButton')}
        </Button>
      </Card>
    </div>
  );
}
