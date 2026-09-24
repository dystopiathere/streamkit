import { zodResolver } from '@hookform/resolvers/zod';
import {
  type AuthResult,
  changePasswordFormSchema,
  type ChangePasswordFormValues,
} from '@streamkit/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Button,
  Card,
  describeField,
  FieldError,
  FieldHint,
  Input,
  Label,
} from '@streamkit/app-kit';
import { ApiError, api } from '@/lib/api';
import { useAuthStore, useCurrentUser } from '@/lib/auth-store';
import { localizedResolver } from '@/lib/form-errors';
import { sessionKeys } from './queries';

type FormValues = ChangePasswordFormValues;

/**
 * Смена пароля. Остальные устройства выходят из аккаунта, это — остаётся:
 * сервер выдаёт ему новую сессию, и её нужно поставить вместо прежней.
 */
export function ChangePasswordCard(): React.JSX.Element {
  const { t } = useTranslation();
  const setSession = useAuthStore((state) => state.setSession);
  const user = useCurrentUser();
  const client = useQueryClient();
  const form = useForm<FormValues>({
    resolver: localizedResolver(zodResolver(changePasswordFormSchema)),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const errors = form.formState.errors;

  const change = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<AuthResult>('/auth/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }),
    onSuccess: (result) => {
      setSession(result.accessToken, result.user);
      form.reset();
      void client.invalidateQueries({ queryKey: sessionKeys.all });
      toast.success(t('security.password.changed'));
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    },
  });

  return (
    <section aria-labelledby="password-title">
      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 id="password-title" className="font-medium">
            {t('security.password.title')}
          </h2>
          <p className="text-sm text-muted">{t('security.password.description')}</p>
        </div>

        <form
          noValidate
          className="max-w-sm space-y-4"
          onSubmit={form.handleSubmit((values) => change.mutate(values))}
        >
          {/* Поле имени скрыто: менеджер паролей сохраняет пару «почта —
            пароль», и без него новый пароль записался бы без аккаунта. */}
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={user?.email ?? ''}
            readOnly
            hidden
          />
          <div>
            <Label htmlFor="currentPassword">{t('security.password.current')}</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              {...describeField('currentPassword', { error: errors.currentPassword?.message })}
              {...form.register('currentPassword')}
            />
            <FieldError id="currentPassword" message={errors.currentPassword?.message} />
          </div>
          <div>
            <Label htmlFor="newPassword">{t('security.password.new')}</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...describeField('newPassword', { hint: true, error: errors.newPassword?.message })}
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
              {...describeField('confirmPassword', { error: errors.confirmPassword?.message })}
              {...form.register('confirmPassword')}
            />
            <FieldError id="confirmPassword" message={errors.confirmPassword?.message} />
          </div>
          <Button type="submit" isLoading={change.isPending}>
            {t('security.password.submit')}
          </Button>
        </form>
      </Card>
    </section>
  );
}
