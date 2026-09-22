import {
  Button,
  cn,
  MainContent,
  MenuButton,
  SkipLink,
  StatusPill,
  useCollapsibleMenu,
} from '@streamkit/app-kit';
import {
  Activity,
  BadgeRussianRuble,
  LayoutDashboard,
  type LucideIcon,
  MonitorPlay,
  ScrollText,
  Users,
  Video,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

const MENU_ID = 'admin-menu';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'nav.overview', icon: LayoutDashboard },
  { to: '/users', label: 'nav.users', icon: Users },
  { to: '/widgets', label: 'nav.widgets', icon: MonitorPlay },
  { to: '/rooms', label: 'nav.rooms', icon: Video },
  { to: '/channels', label: 'nav.channels', icon: Activity },
  { to: '/payments', label: 'nav.payments', icon: BadgeRussianRuble },
  { to: '/audit', label: 'nav.audit', icon: ScrollText, adminOnly: true },
];

/**
 * Каркас админки: боковое меню на широком экране, сворачиваемое — на узком.
 *
 * Шапка несёт роль вошедшего словом: сотрудник должен видеть, с какими правами
 * он сейчас действует, не открывая профиль.
 */
export function AdminLayout(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const staff = useAuthStore((state) => state.staff);
  const clearSession = useAuthStore((state) => state.clearSession);
  const menu = useCollapsibleMenu(MENU_ID);

  const logout = async (): Promise<void> => {
    await api.post('/admin/auth/logout').catch(() => undefined);
    clearSession();
    navigate('/login');
  };

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || staff?.role === 'admin');

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <SkipLink />
      <header className="border-b border-border bg-surface lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:py-5">
          <div>
            <p className="text-base font-semibold tracking-tight">{t('app.name')}</p>
            {staff ? (
              <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                <StatusPill tone={staff.role === 'admin' ? 'accent' : 'neutral'}>
                  {t(`role.${staff.role}`)}
                </StatusPill>
              </p>
            ) : null}
          </div>
          <MenuButton menu={menu} className="lg:hidden" />
        </div>

        <nav
          id={MENU_ID}
          aria-label={t('nav.main')}
          className={cn('px-2 pb-4', menu.open ? 'block' : 'hidden', 'lg:block')}
        >
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm',
                      isActive
                        ? 'bg-surface-hover font-medium text-fg'
                        : 'text-muted hover:bg-surface-hover hover:text-fg',
                    )
                  }
                >
                  <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  {t(item.label)}
                </NavLink>
              </li>
            ))}
          </ul>

          {staff ? (
            <div className="mt-6 border-t border-border px-3 pt-4">
              <p className="truncate text-xs text-muted" title={staff.email}>
                {t('nav.signedInAs', { email: staff.email })}
              </p>
              <Button variant="ghost" className="mt-2 -ml-4" onClick={() => void logout()}>
                {t('nav.logout')}
              </Button>
            </div>
          ) : null}
        </nav>
      </header>

      <MainContent className="min-w-0 px-4 py-6 lg:px-8">
        <Outlet />
      </MainContent>
    </div>
  );
}
