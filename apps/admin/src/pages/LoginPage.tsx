import {
  Button,
  Card,
  describeField,
  FieldError,
  FieldHint,
  Input,
  Label,
  MainContent,
} from '@streamkit/app-kit';
import type { AdminAuthResult } from '@streamkit/contracts';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAdminTitle } from '@/components/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { accessToken, setSession } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useAdminTitle(t('login.title'));

  if (accessToken) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await api.post<AdminAuthResult>('/admin/auth/login', {
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        totpCode: String(form.get('totpCode') ?? '').replace(/\s+/g, ''),
      });
      setSession(result.accessToken, result.user);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('common.error'));
    } finally {
      setPending(false);
    }
  };

  return (
    <MainContent className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">{t('login.title')}</h1>
        <p className="mt-2 text-sm text-muted">{t('login.lead')}</p>

        <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
          <div>
            <Label htmlFor="email">{t('login.email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="password">{t('login.password')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="totpCode">{t('login.totp')}</Label>
            <Input
              id="totpCode"
              name="totpCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\s*(\d\s*){6}"
              required
              className="mt-1 tracking-widest tabular-nums"
              {...describeField('totpCode', { hint: true, error: error ?? undefined })}
            />
            <FieldHint id="totpCode">{t('login.totpHint')}</FieldHint>
          </div>
          {error ? (
            <div role="alert">
              <FieldError id="totpCode" message={error} />
            </div>
          ) : null}
          <Button type="submit" isLoading={pending}>
            {t('login.submit')}
          </Button>
        </form>
      </Card>
    </MainContent>
  );
}
