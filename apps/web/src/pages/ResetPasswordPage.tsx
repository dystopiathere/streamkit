import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordFormSchema, type ResetPasswordFormValues } from '@streamkit/contracts';
import { useEffect, useState } from 'react';
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
import { localizedResolver } from '@/lib/form-errors';
import { usePageMeta } from '@/lib/seo';

/**
 * Токен из фрагмента адреса — и сразу из адреса вон.
 *
 * Фрагмент не уходит на сервер и в Referer, но остаётся в истории браузера и
 * в адресной строке, откуда его унесёт снимок экрана. Читаем один раз при
 * открытии и заменяем адрес на чистый.
 */
function useTokenFromFragment(): string | null {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  return token;
}

/** Новый пароль по ссылке из письма. Сессию не выдаёт: дальше — обычный вход. */
export function ResetPasswordPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useTokenFromFragment();
  const form = useForm<ResetPasswordFormValues>({
    resolver: localizedResolver(zodResolver(resetPasswordFormSchema)),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });
  const errors = form.formState.errors;
  usePageTitle(t('auth.reset.title'));
  usePageMeta({ noindex: true });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post<void>('/auth/password/reset', { token, newPassword: values.newPassword });
      toast.success(t('auth.reset.done'));
      void navigate('/login', { replace: true });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  });

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <MainContent className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <h1 className="mb-2 text-xl font-semibold">{t('auth.reset.title')}</h1>

          {token ? (
            <>
              <p className="mb-6 text-sm text-muted">{t('auth.reset.description')}</p>
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <div>
                  <Label htmlFor="newPassword">{t('security.password.new')}</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    {...describeField('newPassword', {
                      hint: true,
                      error: errors.newPassword?.message,
                    })}
                    {...form.register('newPassword')}
                  />
                  <FieldError id="newPassword" message={errors.newPassword?.message} />
                  <FieldHint id="newPassword">{t('auth.passwordHint')}</FieldHint>
                </div>
                <div>
                  <Label htmlFor="confirmPassword">{t('security.password.confirm')}</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    {...describeField('confirmPassword', {
                      error: errors.confirmPassword?.message,
                    })}
                    {...form.register('confirmPassword')}
                  />
                  <FieldError id="confirmPassword" message={errors.confirmPassword?.message} />
                </div>
                <Button type="submit" className="w-full" isLoading={form.formState.isSubmitting}>
                  {t('auth.reset.submit')}
                </Button>
              </form>
            </>
          ) : (
            <p role="alert" className="text-sm">
              {t('auth.reset.noToken')}
            </p>
          )}

          <Link
            to={token ? '/login' : '/forgot-password'}
            className="mt-4 block text-center text-sm text-muted hover:text-fg"
          >
            {token ? t('auth.forgot.toLogin') : t('auth.reset.requestAgain')}
          </Link>
        </Card>
      </MainContent>
      <PublicFooter />
    </div>
  );
}
