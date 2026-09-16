import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { resetVisitorCookieChoice } from '@/components/CookieBanner';
import { useIsAuthenticated } from '@/lib/auth-store';
import { MISSING, useSeller } from './seller';

const DOCUMENTS = [
  { to: '/legal/terms', label: 'public.footer.terms' },
  { to: '/legal/subscription', label: 'public.footer.offer' },
  { to: '/legal/privacy', label: 'public.footer.privacy' },
  { to: '/legal/personal-data', label: 'public.footer.personalData' },
  { to: '/legal/cookies', label: 'public.footer.cookies' },
];

/**
 * Подвал публичных страниц: документы и реквизиты продавца.
 *
 * Стоит на главной, на страницах документов и у форм входа и регистрации:
 * реквизиты и оферта должны находиться с любой страницы, куда посетитель
 * попадает без аккаунта, — это проверяет модерация ЮKassa.
 */
export function PublicFooter(): React.JSX.Element {
  const { t } = useTranslation();
  const seller = useSeller();
  const authenticated = useIsAuthenticated();

  // Пересмотреть выбор cookie. У вошедшего это раздел «Приватность» с его
  // журналом согласий, у посетителя — снова баннер, а данное согласие отзывается.
  const resetChoice = (): void => {
    resetVisitorCookieChoice().catch(() => toast.error(t('common.error')));
  };

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 text-xs text-muted sm:flex-row sm:justify-between">
        <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label={t('public.footer.documents')}>
          {DOCUMENTS.map((document) => (
            <Link key={document.to} to={document.to} className="hover:text-fg">
              {t(document.label)}
            </Link>
          ))}
          {authenticated ? (
            <Link to="/privacy" className="hover:text-fg">
              {t('public.footer.cookieSettings')}
            </Link>
          ) : (
            <button type="button" onClick={resetChoice} className="hover:text-fg">
              {t('public.footer.cookieSettings')}
            </button>
          )}
        </nav>
        <p data-testid="seller-requisites" className="sm:text-right">
          {t('public.footer.seller', {
            name: seller.data?.name ?? MISSING,
            inn: seller.data?.inn ?? MISSING,
          })}
          <br />
          {seller.data?.email ?? MISSING}
        </p>
      </div>
    </footer>
  );
}
