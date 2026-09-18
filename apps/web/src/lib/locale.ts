import {
  formatMoney as formatMoneyIn,
  isLanguage,
  type Language,
  type Money,
} from '@streamkit/contracts';
import i18n from 'i18next';

/** Явный выбор языка переключателем — ключ в localStorage. */
const STORAGE_KEY = 'streamkit.language';

/**
 * Текущий язык интерфейса.
 *
 * Читается у экземпляра i18next по умолчанию, а не импортом `lib/i18n`: тот
 * при импорте инициализирует переводы по языку браузера, и тесты клиента API
 * внезапно получали бы английские ошибки под jsdom.
 */
export function currentLanguage(): Language {
  const language = i18n.language;
  return isLanguage(language) ? language : 'ru';
}

/** Локаль для `Intl` и `toLocale*`: даты и числа — в формате языка интерфейса. */
export function intlLocale(): string {
  return currentLanguage() === 'en' ? 'en-US' : 'ru-RU';
}

/**
 * Сумма в формате языка интерфейса.
 *
 * Только для дашборда. Рендереры виджетов (`@streamkit/ui`) форматируют
 * по-русски всегда: предпросмотр обязан совпадать с тем, что видно в OBS.
 */
export function formatMoney(money: Money): string {
  return formatMoneyIn(money, intlLocale());
}

export function readStoredLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Хранилище недоступно (приватный режим) — язык продержится до перезагрузки.
  }
}

/** Смена языка переключателем: запоминается, интерфейс перерисовывается без перезагрузки. */
export function setLanguage(language: Language): void {
  rememberLanguage(language);
  void i18n.changeLanguage(language);
}
