import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@streamkit/app-kit';
import { resetVisitorCookieChoice } from '@/components/CookieBanner';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ACCOUNT_SECTIONS, DASHBOARD_SECTIONS } from '@/components/navigation';
import { useIsAuthenticated } from '@/lib/auth-store';
import { missingValue, useSeller } from './seller';

/**
 * Разделы главной. Обычными ссылками, а не `<Link>`: это переходы к якорям
 * другой страницы, и react-router к якорю не прокручивает — посетитель попадал
 * бы на верх главной, куда бы ни нажал.
 */
const SERVICE_LINKS = [
  { href: '/', label: 'public.footer.map.home' },
  { href: '/#pricing', label: 'public.footer.map.pricing' },
  { href: '/#delivery', label: 'public.footer.map.delivery' },
  { href: '/#payment', label: 'public.footer.map.payment' },
];

const DOCUMENTS = [
  { to: '/legal/terms', label: 'public.footer.terms' },
  { to: '/legal/subscription', label: 'public.footer.offer' },
  { to: '/legal/privacy', label: 'public.footer.privacy' },
  { to: '/legal/personal-data', label: 'public.footer.personalData' },
  { to: '/legal/cookies', label: 'public.footer.cookies' },
];

/**
 * Подвал сайта: карта разделов, документы, связь, язык и реквизиты продавца.
 *
 * Стоит на всех страницах — и публичных, и в дашборде. Реквизиты и оферта
 * должны находиться с любой страницы, куда посетитель попадает без аккаунта:
 * это проверяет модерация ЮKassa. Исключения два, и оба не страницы сайта:
 * окно эфира для док-панели OBS и страница гостя комнаты.
 *
 * Зонами, а не одной строкой: пунктов стало полтора десятка, и в строку они
 * переносились в неразличимую кашу, где документы стояли вперемешку с
 * настройками cookie.
 *
 * В дашборде (`dashboard`) карта полная: разделы кабинета и профиля. Шапка
 * показывает только рабочие разделы, а профиль прячется за именем, — подвал
 * единственное место, где весь кабинет виден одним списком. Одинаковые ссылки
 * в шапке и подвале различаются областью: сквозные тесты ищут ссылки шапки
 * внутри её `<nav>`, а не по всей странице.
 *
 * Переключатель языка — здесь, а не в шапке. В шапке он был кнопкой «English»
 * посреди разделов дашборда: коротко и непонятно, что это — раздел, действие
 * или название чего-то. В подвале для него есть место под целую фразу.
 */
export function PublicFooter({ dashboard = false }: { dashboard?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const seller = useSeller();
  const authenticated = useIsAuthenticated();

  // Пересмотреть выбор cookie. У вошедшего это раздел «Приватность» с его
  // журналом согласий, у посетителя — снова баннер, а данное согласие отзывается.
  const resetChoice = (): void => {
    resetVisitorCookieChoice().catch(() => toast.error(t('common.error')));
  };

  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm">
        <div
          className={cn(
            'grid gap-8 sm:grid-cols-2',
            dashboard ? 'lg:grid-cols-5' : 'lg:grid-cols-3',
          )}
        >
          {dashboard ? (
            <>
              <FooterSections
                id="footer-dashboard"
                title={t('public.footer.map.dashboard')}
                items={DASHBOARD_SECTIONS}
              />
              <FooterSections
                id="footer-account"
                title={t('public.footer.map.account')}
                items={ACCOUNT_SECTIONS}
              />
            </>
          ) : null}
          <nav aria-labelledby="footer-service">
            <h2 id="footer-service" className="font-medium">
              {t('public.footer.map.service')}
            </h2>
            <ul className="mt-2 space-y-1.5 text-muted">
              {SERVICE_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="hover:text-fg">
                    {t(link.label)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-documents">
            <h2 id="footer-documents" className="font-medium">
              {t('public.footer.documents')}
            </h2>
            <ul className="mt-2 space-y-1.5 text-muted">
              {DOCUMENTS.map((document) => (
                <li key={document.to}>
                  <Link to={document.to} className="hover:text-fg">
                    {t(document.label)}
                  </Link>
                </li>
              ))}
              <li>
                {authenticated ? (
                  <Link to="/account/privacy" className="hover:text-fg">
                    {t('public.footer.cookieSettings')}
                  </Link>
                ) : (
                  <button type="button" onClick={resetChoice} className="hover:text-fg">
                    {t('public.footer.cookieSettings')}
                  </button>
                )}
              </li>
            </ul>
          </nav>

          <div>
            <h2 className="font-medium">{t('public.footer.map.contact')}</h2>
            <ul className="mt-2 space-y-1.5 text-muted">
              <li>
                {seller.data?.email ? (
                  <a href={`mailto:${seller.data.email}`} className="hover:text-fg">
                    {seller.data.email}
                  </a>
                ) : (
                  missingValue()
                )}
              </li>
              <li>
                <LanguageSwitch />
              </li>
            </ul>
          </div>
        </div>

        {/* Реквизиты — последней строкой: их ищут глазами внизу страницы, и
            модерация ЮKassa смотрит туда же. */}
        <p
          data-testid="seller-requisites"
          className="mt-8 border-t border-border pt-4 text-xs text-muted"
        >
          {t('public.footer.seller', {
            name: seller.data?.name ?? missingValue(),
            inn: seller.data?.inn ?? missingValue(),
          })}
        </p>
      </div>
    </footer>
  );
}

function FooterSections({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: ReadonlyArray<{ to: string; label: string }>;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <nav aria-labelledby={id}>
      <h2 id={id} className="font-medium">
        {title}
      </h2>
      <ul className="mt-2 space-y-1.5 text-muted">
        {items.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="hover:text-fg">
              {t(item.label)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
