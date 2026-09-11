import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from './ui';

const STORAGE_KEY = 'streamkit.cookie-choice';

export type CookieChoice = 'all' | 'necessary';

/**
 * Баннер cookie с реальным выбором.
 *
 * Ключевое: аналитика не инициализируется, пока пользователь не согласился —
 * баннер не «уведомление», а переключатель. Кнопка отказа стоит рядом с кнопкой
 * согласия и выглядит так же: скрытый или задизайненный «в никуда» отказ
 * согласием не считается.
 *
 * Сам выбор хранится в localStorage, потому что это настройка браузера, а не
 * аккаунта: он должен работать и до входа в систему.
 */
export function CookieBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  // Ленивый инициализатор вместо чтения в эффекте: иначе баннер успевает
  // мигнуть у тех, кто уже сделал выбор, и React ругается на синхронный
  // setState внутри эффекта.
  const [choice, setChoice] = useState<CookieChoice | null>(readCookieChoice);

  const decide = (value: CookieChoice): void => {
    window.localStorage.setItem(STORAGE_KEY, value);
    setChoice(value);
    // Здесь появится инициализация аналитики при value === 'all'.
  };

  if (choice !== null) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {t('cookies.message')}{' '}
          <Link to="/legal/cookies" className="underline hover:text-fg">
            {t('cookies.more')}
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => decide('necessary')}>
            {t('cookies.onlyNecessary')}
          </Button>
          <Button onClick={() => decide('all')}>{t('cookies.acceptAll')}</Button>
        </div>
      </div>
    </div>
  );
}

export function readCookieChoice(): CookieChoice | null {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'all' || stored === 'necessary' ? stored : null;
}
