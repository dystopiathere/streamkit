import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { api } from '@/lib/api';
import { useAuthStore, useCurrentUser } from '@/lib/auth-store';
import {
  Button,
  cn,
  MainContent,
  MenuButton,
  SkipLink,
  useCollapsibleMenu,
} from '@streamkit/app-kit';

const NAV_ITEMS = [
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
    <div className="min-h-screen">
      <SkipLink />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 lg:py-3">
          <Link to="/" aria-label={t('nav.home')} className="py-2 font-semibold tracking-tight">
            StreamKit
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
              <ul className="flex flex-col gap-1 lg:flex-row lg:flex-wrap">
                {NAV_ITEMS.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          'block rounded-lg px-3 py-2.5 text-base lg:py-1.5 lg:text-sm',
                          isActive
                            ? 'bg-accent/20 font-medium text-fg'
                            : 'text-muted hover:bg-surface-hover hover:text-fg',
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
              <div className="flex items-center gap-1">
                <LanguageSwitch className="rounded-lg px-3 py-1.5 text-sm text-muted" />
                <Button variant="ghost" onClick={handleLogout}>
                  {t('nav.logout')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <MainContent className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </MainContent>
    </div>
  );
}
