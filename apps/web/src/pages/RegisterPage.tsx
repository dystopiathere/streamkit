import { zodResolver } from '@hookform/resolvers/zod';
import { type AuthResult, type RegisterInput, registerSchema } from '@streamkit/contracts';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
  NewTabHint,
  SkipLink,
  usePageTitle,
} from '@streamkit/app-kit';
import { PublicFooter } from '@/features/public/PublicFooter';
import { trackSiteEvent } from '@/features/public/site-stats';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { localizedResolver } from '@/lib/form-errors';
import { currentLanguage } from '@/lib/locale';
import { usePageMeta } from '@/lib/seo';

/**
 * Документы, которые принимаются регистрацией.
 *
 * Тремя галочками они были раньше, и это не давало выбора: не поставив любую,
 * зарегистрироваться было нельзя. Активное действие — нажатие кнопки под
 * фразой, которая называет документы: так принимают договор, и так же
 * однозначно даётся согласие по 152-ФЗ. Об изменении редакций сервис
 * уведомляет отдельно (`LegalUpdateNotice`), заново ничего подписывать не
 * нужно.
 */
const DOCUMENTS = [
  { label: 'auth.consentTerms', href: '/legal/terms' },
  { label: 'auth.consentPrivacy', href: '/legal/privacy' },
  { label: 'auth.consentPersonalData', href: '/legal/personal-data' },
] as const;

export function RegisterPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setSession = useAuthStore((state) => state.setSession);

  const form = useForm<RegisterInput>({
    resolver: localizedResolver(zodResolver(registerSchema)),
    defaultValues: {
      email: '',
      password: '',
      displayName: '',
      acceptDocuments: true,
      // Ссылка из раздела «Приглашения» приносит промокод в адресе: вписывать
      // его руками приходится только тем, кому код продиктовали.
      referralCode: params.get('ref') ?? '',
    },
  });

  const errors = form.formState.errors;
  usePageTitle(t('auth.registerTitle'));
  usePageMeta({
    description: t('seo.register.description'),
    path: '/register',
    language: i18n.language === 'en' ? 'en' : 'ru',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await api.post<AuthResult>('/auth/register', {
        ...values,
        language: currentLanguage(),
      });
      setSession(result.accessToken, result.user);
      trackSiteEvent('signup');
      void navigate('/widgets');
    } catch (error) {
      // Остальное форма проверила сама, и 400 при заполненном промокоде — это он.
      if (error instanceof ApiError && error.status === 400 && values.referralCode) {
        form.setError('referralCode', { message: error.message }, { shouldFocus: true });
        return;
      }
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  });

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <MainContent className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <h1 className="mb-6 text-xl font-semibold">{t('auth.registerTitle')}</h1>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="displayName">{t('auth.displayName')}</Label>
              <Input
                id="displayName"
                autoComplete="nickname"
                {...describeField('displayName', { error: errors.displayName?.message })}
                {...form.register('displayName')}
              />
              <FieldError id="displayName" message={errors.displayName?.message} />
            </div>

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
                autoComplete="new-password"
                {...describeField('password', { hint: true, error: errors.password?.message })}
                {...form.register('password')}
              />
              <FieldHint id="password">{t('auth.passwordHint')}</FieldHint>
              <FieldError id="password" message={errors.password?.message} />
            </div>

            <div>
              <Label htmlFor="referralCode">{t('auth.referralCode')}</Label>
              <Input
                id="referralCode"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                {...describeField('referralCode', {
                  hint: true,
                  error: errors.referralCode?.message,
                })}
                {...form.register('referralCode')}
              />
              <FieldHint id="referralCode">{t('auth.referralCodeHint')}</FieldHint>
              <FieldError id="referralCode" message={errors.referralCode?.message} />
            </div>

            {/* Документы — перед кнопкой, а не после: фраза объясняет, что
                означает нажатие, и прочитать её надо до нажатия. */}
            <div className="border-t border-border pt-4 text-xs text-muted">
              <p>
                {t('auth.acceptByRegistering', { button: t('auth.submitRegister') })}{' '}
                {DOCUMENTS.map((document, index) => (
                  <span key={document.href}>
                    {index > 0 ? ', ' : ''}
                    <Link to={document.href} target="_blank" className="underline hover:text-fg">
                      {t(document.label)}
                      <NewTabHint />
                    </Link>
                  </span>
                ))}
                .
              </p>
              <p className="mt-1">{t('auth.acceptUpdates')}</p>
            </div>

            <Button type="submit" className="w-full" isLoading={form.formState.isSubmitting}>
              {t('auth.submitRegister')}
            </Button>
          </form>

          <Link to="/login" className="mt-4 block text-center text-sm text-muted hover:text-fg">
            {t('auth.toLogin')}
          </Link>
        </Card>
      </MainContent>
      <PublicFooter />
    </div>
  );
}
