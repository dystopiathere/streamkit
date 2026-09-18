import { isLanguage, type Language } from '@streamkit/contracts';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import ru from '@/locales/ru.json';
import { readStoredLanguage, rememberLanguage } from './locale';

/**
 * Язык при загрузке страницы.
 *
 * 1. `?lang=en` в адресе — ссылка, которая открывает сайт на нужном языке
 *    (так её дают, например, проверяющим Google). Запоминается как выбор.
 * 2. Прежний выбор переключателем.
 * 3. Язык браузера: первый из списка, который у нас есть. Если нет ни одного —
 *    русский: сервис для аудитории РФ, и у казахского или украинского браузера
 *    русский вероятнее английского.
 */
function detectLanguage(): Language {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (isLanguage(fromUrl)) {
    rememberLanguage(fromUrl);
    return fromUrl;
  }

  const stored = readStoredLanguage();
  if (stored) return stored;

  const preferred = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) return primary;
  }
  return 'ru';
}

// `lang` у документа — для скринридера (произношение) и переносов в CSS.
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en } },
  lng: detectLanguage(),
  fallbackLng: 'ru',
  interpolation: {
    // React сам экранирует вставляемые значения — двойное экранирование ломает
    // текст с кавычками и амперсандами.
    escapeValue: false,
  },
});

export default i18n;
