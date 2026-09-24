import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@streamkit/app-kit';
import { api } from '@/lib/api';
import { useAuthStore, useCurrentUser } from '@/lib/auth-store';
import { ACCOUNT_SECTIONS } from './navigation';

/**
 * Меню профиля: имя в шапке раскрывает разделы аккаунта и «Выйти».
 *
 * Раскрывающийся блок, а не ARIA-меню (`role="menu"`): внутри обычные ссылки,
 * и Tab по ним работает, как везде на сайте. Роль меню обязывала бы к
 * навигации стрелками и выключала бы привычный Tab — ради пяти пунктов это
 * сложность без пользы.
 *
 * Закрывается переходом, Escape (фокус возвращается на имя), щелчком мимо и
 * уходом фокуса из блока: иначе раскрытый список висел бы над страницей, по
 * которой человек уже идёт клавиатурой.
 */
export function ProfileMenu({ className }: { className?: string }): React.JSX.Element | null {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const clearSession = useAuthStore((state) => state.clearSession);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Подстройка под смену адреса — в рендере, как у мобильного меню.
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (!user) return null;

  const handleLogout = async (): Promise<void> => {
    // Сначала гасим сессию на сервере, потом чистим клиент: обратный порядок
    // оставил бы живой refresh-токен, если запрос не дойдёт.
    await api.post('/auth/logout').catch(() => undefined);
    clearSession();
    void navigate('/login');
  };

  const inAccount = pathname.startsWith('/account');

  return (
    <div
      ref={rootRef}
      className={cn('relative', className)}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        // Раздел профиля отмечается той же жёлтой чертой, что и разделы
        // кабинета: имя здесь — вход в раздел, а не просто подпись.
        className={cn(
          'flex h-11 max-w-[14rem] items-center gap-1.5 rounded-lg px-3 text-sm lg:h-auto lg:rounded-none lg:px-2.5 lg:py-4',
          inAccount
            ? 'font-medium text-fg lg:shadow-[inset_0_-2px_0_var(--color-accent)]'
            : 'text-muted hover:text-fg',
        )}
      >
        {/* Пробел внутри скрытой подписи: без него имя кнопки склеивается в
            «Профиль:Имя», и скринридер читает это одним словом. */}
        <span className="sr-only">{`${t('nav.profileOf')} `}</span>
        <span className="truncate">{user.displayName}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('h-4 w-4 shrink-0', open ? 'rotate-180' : undefined)}
        />
      </button>

      <div
        id={panelId}
        hidden={!open}
        // Парит над страницей — единственный случай, где тень разрешена.
        className="absolute right-0 z-50 mt-1 w-64 rounded-xl border border-border bg-surface p-2 shadow-[0_12px_32px_rgb(0_0_0/0.45)]"
      >
        <div className="border-b border-border px-3 pt-1 pb-3">
          <p className="truncate text-sm font-medium">{user.displayName}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
        <nav aria-label={t('nav.profile')} className="py-1">
          <ul className="space-y-0.5">
            {ACCOUNT_SECTIONS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-lg px-3 py-2 text-sm',
                      isActive
                        ? 'bg-surface-hover font-medium text-fg'
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
        <div className="border-t border-border pt-1">
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface-hover hover:text-fg"
          >
            {t('nav.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}
