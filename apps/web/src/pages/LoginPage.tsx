import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, type LoginResponse, loginSchema } from '@streamkit/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, FieldError, Input, Label } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  // Форма логина двухшаговая: поле кода появляется только если сервер сказал,
  // что у аккаунта включён второй фактор. Показывать его всем — лишний вопрос.
  const [needsTotp, setNeedsTotp] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const response = await api.post<LoginResponse>('/auth/login', values);

      if ('totpRequired' in response) {
        setNeedsTotp(true);
        return;
      }

      setSession(response.accessToken, response.user);
      void navigate('/widgets');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">{t('auth.loginTitle')}</h1>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            <FieldError message={form.formState.errors.email?.message} />
          </div>

          <div>
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
            <FieldError message={form.formState.errors.password?.message} />
          </div>

          {needsTotp ? (
            <div>
              <Label htmlFor="totpCode">{t('auth.totpCode')}</Label>
              <Input
                id="totpCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                {...form.register('totpCode')}
              />
              <FieldError message={form.formState.errors.totpCode?.message} />
              <p className="mt-1 text-xs text-muted">{t('auth.totpRequired')}</p>
            </div>
          ) : null}

          <Button type="submit" className="w-full" isLoading={form.formState.isSubmitting}>
            {t('auth.submitLogin')}
          </Button>
        </form>

        <Link to="/register" className="mt-4 block text-center text-sm text-muted hover:text-fg">
          {t('auth.toRegister')}
        </Link>
      </Card>
    </div>
  );
}
