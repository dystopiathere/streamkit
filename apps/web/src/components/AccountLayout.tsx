import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@streamkit/app-kit';
import { ACCOUNT_SECTIONS } from './navigation';

/**
 * Раздел профиля: площадки, безопасность, тариф, приватность.
 *
 * Меню раздела повторено слева от страницы, хотя оно есть и под именем в шапке:
 * из «Безопасности» в «Тариф» переходят подряд, и открывать ради этого меню
 * заново — лишний шаг. На телефоне это строка вкладок над страницей, которая
 * прокручивается вбок, а не колонка, съедающая пол-экрана.
 */
export function AccountLayout(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="gap-8 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label={t('nav.profileSections')} className="mb-6 lg:mb-0">
        <ul className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border lg:flex-col lg:overflow-visible lg:border-0">
          {ACCOUNT_SECTIONS.map((item) => (
            <li key={item.to} className="shrink-0">
              <NavLink
                to={item.to}
                // Текущий раздел — чертой, как вкладки: снизу на телефоне,
                // слева в колонке. Без перехода цвета, см. DESIGN.md.
                className={({ isActive }) =>
                  cn(
                    'block px-3 py-2.5 text-sm whitespace-nowrap lg:rounded-lg',
                    isActive
                      ? 'font-medium text-fg shadow-[inset_0_-2px_0_var(--color-accent)] lg:bg-surface-hover lg:shadow-[inset_2px_0_0_var(--color-accent)]'
                      : 'text-muted hover:text-fg lg:hover:bg-surface-hover',
                  )
                }
              >
                {t(item.label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
