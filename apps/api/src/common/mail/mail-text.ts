import type { MailLanguage } from '@streamkit/contracts';

/**
 * Даты в письмах — по Москве: аудитория в России, а «15 октября» по UTC для
 * события в 02:00 ночи по Москве было бы уже вчерашним числом. Часовой пояс
 * назван словами — письмо может открыть человек в другом поясе.
 */
const DATE: Record<MailLanguage, Intl.DateTimeFormat> = {
  ru: new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }),
  en: new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }),
};

const TIME: Record<MailLanguage, Intl.DateTimeFormat> = {
  ru: new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }),
  en: new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }),
};

const MOSCOW_TIME: Record<MailLanguage, string> = { ru: 'по Москве', en: 'Moscow time' };

/**
 * «26 сентября 2026» / «26 September 2026».
 *
 * Без «г.», который добавляет ru-RU: дата стоит и посреди фразы, и в конце
 * предложения, и там «2026 г..» — две точки подряд, а перенос строки отрывал
 * «г.» от года.
 */
export function formatMailDate(date: Date, language: MailLanguage): string {
  return DATE[language].format(date).replace(/\s*г\.$/, '');
}

/** «26 сентября 2026, 10:15 по Москве» / «26 September 2026, 10:15 Moscow time». */
export function formatMailDateTime(date: Date, language: MailLanguage): string {
  return `${formatMailDate(date, language)}, ${TIME[language].format(date)} ${MOSCOW_TIME[language]}`;
}

/**
 * Адрес страницы дашборда для письма.
 *
 * Английскому письму — английская страница: язык интерфейса берётся из
 * `?lang=en` раньше, чем из браузера, а письмо могли открыть на чужом
 * компьютере с русским браузером.
 *
 * @param base — `WEB_BASE_URL`, с косой чертой на конце или без.
 * @param path — путь от корня, например `/account/security`.
 */
export function mailUrl(base: string, path: string, language: MailLanguage): string {
  const url = new URL(path, `${base.replace(/\/+$/, '')}/`);
  if (language === 'en') url.searchParams.set('lang', 'en');
  return url.toString();
}

/** Подпись устройства, когда User-Agent ничего не сказал. */
export const UNKNOWN_DEVICE: Record<MailLanguage, string> = {
  ru: 'Неизвестный браузер',
  en: 'Unknown browser',
};
