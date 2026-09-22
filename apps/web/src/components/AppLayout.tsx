import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LegalUpdateNotice } from '@/components/LegalUpdateNotice';
import { PublicFooter } from '@/features/public/PublicFooter';
import { api } from '@/lib/api';
import { useAuthStore, useCurrentUser } from '@/lib/auth-store';
import {
  Button,
  cn,
  Logo,
  MainContent,
  MenuButton,
  SkipLink,
  useCollapsibleMenu,
} from '@streamkit/app-kit';

const NAV_ITEMS = [
  { to: '/stream', label: 'nav.stream' },
  { to: '/widgets', label: 'nav.widgets' },
  { to: '/events', label: 'nav.events' },
  { to: '/analytics', label: 'nav.analytics' },
  { to: '/rooms', label: 'nav.rooms' },
  { to: '/sources', label: 'nav.sources' },
  { to: '/billing', label: 'nav.billing' },
  { to: '/privacy', label: 'nav.privacy' },
];

const MENU_ID = 'app-menu';

/**
 * Каркас дашборда.
 *
 * Семь разделов в строку помещаются только на широком экране. Уже `lg` меню
 * сворачивается под кнопку: раньше оно переносилось на две-три строки и
 * занимало пол-экрана телефона ещё до содержимого.
 */
export function AppLayout(): React.JSX.Element {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const clearSession = useAuthStore((state) => state.clearSession);
  const navigate = useNavigate();
  const menu = useCollapsibleMenu(MENU_ID);

  const handleLogout = async (): Promise<void> => {
    // Сначала гасим сессию на сервере, потом чистим клиент: обратный порядок
    // оставил бы живой refresh-токен, если запрос не дойдёт.
    await api.post('/auth/logout').catch(() => undefined);
    clearSession();
    void navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 lg:py-0">
          <Link to="/" aria-label={t('nav.home')} className="py-2 lg:mr-2">
            <Logo />
          </Link>

          <MenuButton menu={menu} className="ml-auto lg:hidden" />

          <div
            id={MENU_ID}
            className={cn(
              menu.open ? 'flex' : 'hidden',
              'w-full flex-col gap-2 pb-2',
              'lg:flex lg:w-auto lg:flex-1 lg:flex-row lg:items-center lg:gap-4 lg:pb-0',
            )}
          >
            <nav aria-label={t('nav.main')} className="lg:flex-1">
              <ul className="flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:gap-0.5">
                {NAV_ITEMS.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      // Текущий раздел — жёлтой чертой у нижнего края шапки, как
                      // метка выбранного канала, а не заливкой: жёлтая заливка
                      // читалась бы как главная кнопка.
                      className={({ isActive }) =>
                        cn(
                          'block rounded-lg px-3 py-2.5 text-base lg:rounded-none lg:px-2.5 lg:py-4 lg:text-sm',
                          isActive
                            ? 'bg-surface-hover font-medium text-fg lg:bg-transparent lg:shadow-[inset_0_-2px_0_var(--color-accent)]'
                            : 'text-muted hover:bg-surface-hover hover:text-fg lg:hover:bg-transparent',
                        )
                      }
                    >
                      {t(item.label)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-2 lg:border-0 lg:pt-0">
              <span className="min-w-0 truncate px-3 text-sm text-muted lg:px-0">
                {user?.displayName}
              </span>
              {/* Переключателя языка здесь больше нет: кнопка «English» между
                  разделами дашборда читалась как ещё один раздел. Он в подвале,
                  целой фразой. */}
              <Button variant="ghost" onClick={handleLogout}>
                {t('nav.logout')}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Подвал прижат к низу: на короткой странице («Источники» без
          подключений) он иначе висел бы посреди экрана. */}
      <MainContent className="app-main mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {/* Уведомление о новой редакции документов — над содержимым любой
            страницы дашборда: раньше узнать об изменении можно было только
            зайдя в «Приватность». Ничего не блокирует. */}
        <LegalUpdateNotice />
        <Outlet />
      </MainContent>

      <PublicFooter />
    </div>
  );
}
