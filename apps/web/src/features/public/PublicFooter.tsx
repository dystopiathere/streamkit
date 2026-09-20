import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { resetVisitorCookieChoice } from '@/components/CookieBanner';
import { LanguageSwitch } from '@/components/LanguageSwitch';
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
 * Разделов дашборда в карте нет намеренно: они все до одного стоят в шапке, и
 * второй их список ничего не добавляет, зато делает каждую ссылку на странице
 * неоднозначной — и для человека, и для сквозных тестов.
 *
 * Переключатель языка — здесь, а не в шапке. В шапке он был кнопкой «English»
 * посреди разделов дашборда: коротко и непонятно, что это — раздел, действие
 * или название чего-то. В подвале для него есть место под целую фразу.
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
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
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
                  <Link to="/privacy" className="hover:text-fg">
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
