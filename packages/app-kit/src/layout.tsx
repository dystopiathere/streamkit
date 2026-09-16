import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { cn } from './primitives';

/** Идентификатор основного содержимого — цель ссылки «к содержимому». */
export const MAIN_ID = 'main';

/**
 * Первая остановка Tab на любой странице.
 *
 * Без неё человек с клавиатурой или скринридером на каждой странице дашборда
 * проходит все семь пунктов меню, прежде чем добраться до содержимого.
 */
export function SkipLink(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <a
      href={`#${MAIN_ID}`}
      className="sr-only-focusable fixed top-2 left-2 z-[60] rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg"
    >
      {t('common.skipToContent')}
    </a>
  );
}

/**
 * Состояние мобильного меню.
 *
 * Меню закрывается переходом на другую страницу (иначе новая страница
 * открывалась бы под раскрытым списком) и клавишей Escape — с возвратом фокуса
 * на кнопку, иначе фокус остался бы на исчезнувшем пункте.
 */
export function useCollapsibleMenu(controls: string) {
  const [open, setOpen] = useState(false);
  const { pathname, hash } = useLocation();

  // Подстройка состояния под смену адреса — в рендере, а не в эффекте.
  const location = `${pathname}${hash}`;
  const [seen, setSeen] = useState(location);
  if (seen !== location) {
    setSeen(location);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      document.getElementById(menuButtonId(controls))?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, controls]);

  return {
    open,
    controls,
    close: () => setOpen(false),
    toggle: () => setOpen((value) => !value),
  };
}

const menuButtonId = (controls: string): string => `${controls}-button`;

export function MenuButton({
  menu,
  className,
}: {
  menu: ReturnType<typeof useCollapsibleMenu>;
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const Icon = menu.open ? X : Menu;
  return (
    <button
      id={menuButtonId(menu.controls)}
      type="button"
      aria-expanded={menu.open}
      aria-controls={menu.controls}
      aria-label={menu.open ? t('nav.closeMenu') : t('nav.openMenu')}
      onClick={menu.toggle}
      // 44×44 — минимальный размер цели касания.
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-lg text-fg hover:bg-surface-hover',
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}

/**
 * Заголовок вкладки по странице.
 *
 * В одностраничном приложении заголовок сам не меняется, и скринридер после
 * перехода не сообщает, где человек оказался, а в истории браузера все
 * страницы называются одинаково.
 */
export function usePageTitle(title: string | undefined, appName = 'StreamKit'): void {
  useEffect(() => {
    document.title = title ? `${title} — ${appName}` : appName;
  }, [title, appName]);
}

/**
 * Основное содержимое страницы.
 *
 * После перехода по меню фокус переносится сюда: иначе он остаётся на пункте
 * меню, и скринридер молчит, хотя страница под ним сменилась. При первой
 * загрузке фокус не трогается — браузер сам начинает с начала документа.
 */
export function MainContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <main ref={ref} id={MAIN_ID} tabIndex={-1} className={cn('outline-none', className)}>
      {children}
    </main>
  );
}
