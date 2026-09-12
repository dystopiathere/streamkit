import { zodResolver } from '@hookform/resolvers/zod';
import { type AuthResult, type RegisterInput, registerSchema } from '@streamkit/contracts';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, FieldError, Input, Label } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Согласия оформлены отдельными чекбоксами и не проставлены заранее.
 *
 * 152-ФЗ требует активного действия пользователя: предустановленная галочка
 * согласием не считается, а «согласие со всем сразу» не позволяет отличить
 * обязательные документы от необязательных.
 */
const CONSENT_FIELDS = [
  { name: 'consents.terms', label: 'auth.consentTerms', href: '/legal/terms' },
  { name: 'consents.privacy', label: 'auth.consentPrivacy', href: '/legal/privacy' },
  {
    name: 'consents.personalData',
    label: 'auth.consentPersonalData',
    href: '/legal/personal-data',
  },
] as const;

export function RegisterPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      displayName: '',
      consents: { terms: false, privacy: false, personalData: false } as never,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await api.post<AuthResult>('/auth/register', values);
      setSession(result.accessToken, result.user);
      void navigate('/widgets');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  });

  const consentsInvalid = Boolean(form.formState.errors.consents);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">{t('auth.registerTitle')}</h1>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="displayName">{t('auth.displayName')}</Label>
            <Input id="displayName" autoComplete="nickname" {...form.register('displayName')} />
            <FieldError message={form.formState.errors.displayName?.message} />
          </div>

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
              autoComplete="new-password"
              {...form.register('password')}
            />
            <p className="mt-1 text-xs text-muted">{t('auth.passwordHint')}</p>
            <FieldError message={form.formState.errors.password?.message} />
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            {CONSENT_FIELDS.map((field) => (
              <label key={field.name} className="flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  {...form.register(field.name as 'consents.terms')}
                />
                <span>
                  <Link to={field.href} target="_blank" className="underline hover:text-fg">
                    {t(field.label)}
                  </Link>
                </span>
              </label>
            ))}
            {consentsInvalid ? <FieldError message={t('auth.consentRequired')} /> : null}
          </div>

          <Button type="submit" className="w-full" isLoading={form.formState.isSubmitting}>
            {t('auth.submitRegister')}
          </Button>
        </form>

        <Link to="/login" className="mt-4 block text-center text-sm text-muted hover:text-fg">
          {t('auth.toLogin')}
        </Link>
      </Card>
    </div>
  );
}
