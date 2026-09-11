import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from '../locales/ru.json';

/**
 * Локализация с единственной локалью `ru`.
 *
 * Язык пока один, но весь интерфейс сразу пишется через ключи: вынести сотни
 * зашитых строк из готовых компонентов заметно дороже, чем с самого начала
 * обращаться к `t()`. Добавление второго языка сведётся к новому JSON.
 */
void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru } },
  lng: 'ru',
  fallbackLng: 'ru',
  interpolation: {
    // React сам экранирует вставляемые значения — двойное экранирование ломает
    // текст с кавычками и амперсандами.
    escapeValue: false,
  },
});

export default i18n;
