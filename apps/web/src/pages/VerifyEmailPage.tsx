import type { PublicUser } from '@streamkit/contracts';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, MainContent, SkipLink, usePageTitle } from '@streamkit/app-kit';
import { PublicFooter } from '@/features/public/PublicFooter';
import { api } from '@/lib/api';
import { useAuthStore, useIsAuthenticated } from '@/lib/auth-store';
import { useTokenFromFragment } from '@/lib/fragment-token';
import { usePageMeta } from '@/lib/seo';

type VerifyState = 'checking' | 'done' | 'failed' | 'noToken';

/**
 * Подтверждение почты по ссылке из письма.
 *
 * Без входа: письмо часто открывают на телефоне, где в дашборд не входили.
 * Запрос уходит сам при открытии — нажимать на странице нечего, ссылка в
 * письме и есть кнопка.
 */
export function VerifyEmailPage(): React.JSX.Element {
  const { t } = useTranslation();
  const token = useTokenFromFragment();
  const authenticated = useIsAuthenticated();
  const patchUser = useAuthStore((state) => state.patchUser);
  const [state, setState] = useState<VerifyState>(token ? 'checking' : 'noToken');
  // StrictMode вызывает эффект дважды; повтор сервер пережил бы, но второй
  // запрос в журнале выглядел бы как второе открытие ссылки.
  const sent = useRef(false);
  usePageTitle(t('emailVerification.page.title'));
  usePageMeta({ noindex: true });

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api
      .post<void>('/auth/email/verify', { token })
      .then(() => {
        setState('done');
        // Ссылка могла прийти на другой аккаунт, чем тот, что открыт в этом
        // браузере, — флаг берём у сервера, а не выводим из ответа. Не вышло —
        // плашка в дашборде перечитает профиль сама.
        if (!useAuthStore.getState().accessToken) return;
        api
          .get<PublicUser>('/auth/me')
          .then((me) => patchUser({ emailVerified: me.emailVerified }))
          .catch(() => undefined);
      })
      .catch(() => setState('failed'));
  }, [token, patchUser]);

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <MainContent className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <h1 className="mb-2 text-xl font-semibold">{t('emailVerification.page.title')}</h1>
          <p
            role={state === 'failed' || state === 'noToken' ? 'alert' : 'status'}
            className="text-sm"
          >
            {t(`emailVerification.page.${state}`)}
          </p>
          {state === 'checking' ? null : (
            <Link
              to={authenticated ? '/widgets' : '/login'}
              className="mt-4 block text-center text-sm text-muted hover:text-fg"
            >
              {authenticated
                ? t('emailVerification.page.toDashboard')
                : t('emailVerification.page.toLogin')}
            </Link>
          )}
        </Card>
      </MainContent>
      <PublicFooter />
    </div>
  );
}
