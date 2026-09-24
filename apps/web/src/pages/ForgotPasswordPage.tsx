import { zodResolver } from '@hookform/resolvers/zod';
import { emailSchema } from '@streamkit/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  Button,
  Card,
  describeField,
  FieldError,
  Input,
  Label,
  MainContent,
  SkipLink,
  usePageTitle,
} from '@streamkit/app-kit';
import { PublicFooter } from '@/features/public/PublicFooter';
import { ApiError, api } from '@/lib/api';
import { localizedResolver } from '@/lib/form-errors';
import { currentLanguage } from '@/lib/locale';
import { usePageMeta } from '@/lib/seo';

const formSchema = z.object({ email: emailSchema });
type FormValues = z.infer<typeof formSchema>;

/**
 * Запрос письма со ссылкой восстановления.
 *
 * После отправки страница говорит «если аккаунт есть, письмо ушло» — и ничего
 * больше: сервер отвечает одинаково на любой адрес, и интерфейс не вправе
 * угадывать за него. Письмо уходит на языке этой страницы.
 */
export function ForgotPasswordPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: localizedResolver(zodResolver(formSchema)),
    defaultValues: { email: '' },
  });
  const errors = form.formState.errors;
  usePageTitle(t('auth.forgot.title'));
  usePageMeta({ noindex: true });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post<void>('/auth/password/forgot', {
        email: values.email,
        language: currentLanguage(),
      });
      setSentTo(values.email);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  });

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <MainContent className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <h1 className="mb-2 text-xl font-semibold">{t('auth.forgot.title')}</h1>

          {sentTo ? (
            <div role="status" className="space-y-3 text-sm">
              <p>{t('auth.forgot.sent', { email: sentTo })}</p>
              <p className="text-muted">{t('auth.forgot.sentHint')}</p>
            </div>
          ) : (
            <>
              <p className="mb-6 text-sm text-muted">{t('auth.forgot.description')}</p>
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
                <Button type="submit" className="w-full" isLoading={form.formState.isSubmitting}>
                  {t('auth.forgot.submit')}
                </Button>
              </form>
            </>
          )}

          <Link to="/login" className="mt-4 block text-center text-sm text-muted hover:text-fg">
            {t('auth.forgot.toLogin')}
          </Link>
        </Card>
      </MainContent>
      <PublicFooter />
    </div>
  );
}
