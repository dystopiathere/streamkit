import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { EmailVerificationNotice } from '@/components/EmailVerificationNotice';
import { LegalUpdateNotice } from '@/components/LegalUpdateNotice';
import { PublicFooter } from '@/features/public/PublicFooter';
import {
  cn,
  Logo,
  MainContent,
  MenuButton,
  SkipLink,
  useCollapsibleMenu,
} from '@streamkit/app-kit';
import { DASHBOARD_SECTIONS } from './navigation';
import { ProfileMenu } from './ProfileMenu';

const MENU_ID = 'app-menu';

/**
 * Каркас дашборда.
 *
 * В шапке — рабочие разделы и имя, которое раскрывает профиль: площадки,
 * источники донатов, безопасность, тариф, приватность и выход (`ProfileMenu`). Уже `lg` разделы
 * сворачиваются под кнопку, а имя остаётся на виду: профиль нужен и на телефоне,
 * и прятать его во второе меню значило бы два нажатия до «Выйти».
 */
export function AppLayout(): React.JSX.Element {
  const { t } = useTranslation();
  const menu = useCollapsibleMenu(MENU_ID);

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 lg:gap-x-4 lg:py-0">
          <Link to="/" aria-label={t('nav.home')} className="py-2 lg:mr-2">
            <Logo />
          </Link>

          {/* Порядок в строке задаёт CSS: на телефоне имя и кнопка меню стоят
              справа от знака, а разделы уходят строкой ниже; на `lg` разделы
              встают между знаком и именем. */}
          <ProfileMenu className="ml-auto lg:order-2 lg:ml-0" />
          <MenuButton menu={menu} className="lg:hidden" />

          <div
            id={MENU_ID}
            className={cn(
              menu.open ? 'flex' : 'hidden',
              'order-last w-full flex-col pb-2',
              'lg:order-1 lg:flex lg:w-auto lg:flex-1 lg:flex-row lg:items-center lg:pb-0',
            )}
          >
            <nav aria-label={t('nav.main')} className="lg:flex-1">
              <ul className="flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:gap-0.5">
                {DASHBOARD_SECTIONS.map((item) => (
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
          </div>
        </div>
      </header>

      {/* Подвал прижат к низу: на короткой странице («Комнаты» без
          комнат) он иначе висел бы посреди экрана. */}
      <MainContent className="app-main mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {/* Уведомление о новой редакции документов — над содержимым любой
            страницы дашборда: раньше узнать об изменении можно было только
            зайдя в «Приватность». Ничего не блокирует. */}
        <EmailVerificationNotice />
        <LegalUpdateNotice />
        <Outlet />
      </MainContent>

      <PublicFooter dashboard />
    </div>
  );
}
