import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore, useCurrentUser } from '@/lib/auth-store';
import { CookieBanner } from './CookieBanner';
import { Button, cn } from './ui';

const NAV_ITEMS = [
  { to: '/widgets', label: 'nav.widgets' },
  { to: '/events', label: 'nav.events' },
  { to: '/analytics', label: 'nav.analytics' },
  { to: '/sources', label: 'nav.sources' },
  { to: '/privacy', label: 'nav.privacy' },
];

export function AppLayout(): React.JSX.Element {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const clearSession = useAuthStore((state) => state.clearSession);
  const navigate = useNavigate();

  const handleLogout = async (): Promise<void> => {
    // Сначала гасим сессию на сервере, потом чистим клиент: обратный порядок
    // оставил бы живой refresh-токен, если запрос не дойдёт.
    await api.post('/auth/logout').catch(() => undefined);
    clearSession();
    void navigate('/login');
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold tracking-tight">StreamKit</span>

          <nav className="flex flex-1 flex-wrap gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-1.5 text-sm',
                    isActive ? 'bg-accent/15 text-fg' : 'text-muted hover:text-fg',
                  )
                }
              >
                {t(item.label)}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{user?.displayName}</span>
            <Button variant="ghost" onClick={handleLogout}>
              {t('nav.logout')}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <CookieBanner />
    </div>
  );
}
