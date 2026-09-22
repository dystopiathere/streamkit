import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, type LoginResponse, loginSchema } from '@streamkit/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Button,
  Card,
  describeField,
  FieldError,
  FieldHint,
  Input,
  Label,
  MainContent,
  SkipLink,
  usePageTitle,
} from '@streamkit/app-kit';
import { PublicFooter } from '@/features/public/PublicFooter';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { localizedResolver } from '@/lib/form-errors';
import { usePageMeta } from '@/lib/seo';

export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  // Форма логина двухшаговая: поле кода появляется только если сервер сказал,
  // что у аккаунта включён второй фактор. Показывать его всем — лишний вопрос.
  const [needsTotp, setNeedsTotp] = useState(false);

  const form = useForm<LoginInput>({
    resolver: localizedResolver(zodResolver(loginSchema)),
    defaultValues: { email: '', password: '' },
  });

  const errors = form.formState.errors;
  usePageTitle(t('auth.loginTitle'));
  // Вход в выдаче не нужен: из поиска приходят на главную и к регистрации.
  usePageMeta({ noindex: true });

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
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <MainContent className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <h1 className="mb-6 text-xl font-semibold">{t('auth.loginTitle')}</h1>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                {...describeField('email', { error: errors.email?.message })}
                {...form.register('email')}
              />
              <FieldError id="email" message={errors.email?.message} />
            </div>

            <div>
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...describeField('password', { error: errors.password?.message })}
                {...form.register('password')}
              />
              <FieldError id="password" message={errors.password?.message} />
            </div>

            {needsTotp ? (
              <div>
                <Label htmlFor="totpCode">{t('auth.totpCode')}</Label>
                <Input
                  id="totpCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  {...describeField('totpCode', { hint: true, error: errors.totpCode?.message })}
                  {...form.register('totpCode')}
                />
                <FieldError id="totpCode" message={errors.totpCode?.message} />
                <FieldHint id="totpCode">{t('auth.totpRequired')}</FieldHint>
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
      </MainContent>
      <PublicFooter />
    </div>
  );
}
