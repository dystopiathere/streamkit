import { useEffect } from 'react';

/**
 * Адрес сайта для поисковиков: canonical, hreflang, sitemap.
 *
 * Абсолютный и один на все окружения, а не `location.origin`: canonical,
 * собранный из адреса стенда, объявил бы стенд главной версией сайта. Меняется
 * на сборке (`VITE_SITE_URL`), как и остальные адреса.
 */
export const SITE_URL = (import.meta.env.VITE_SITE_URL ?? 'https://stream-kit.ru').replace(
  /\/+$/,
  '',
);

interface PageMeta {
  /** Описание для выдачи. Нет — остаётся общее из index.html. */
  description?: string;
  /**
   * Путь канонического адреса без языка: `/`, `/legal/terms`. У страницы две
   * языковые версии (`?lang=en`), и canonical у каждой — свой, а связь между
   * ними — hreflang. Нет пути — страница вне выдачи, ссылок не ставим.
   */
  path?: string;
  /** Язык страницы, если она публичная: от него зависит canonical. */
  language?: 'ru' | 'en';
  /** Закрыть от индексации: кабинет, вход, страница гостя. */
  noindex?: boolean;
}

/**
 * Метаданные страницы для поисковиков и соцсетей.
 *
 * SPA отдаёт один index.html на все адреса, поэтому описание, canonical и
 * robots выставляются при переходе. Google и Яндекс исполняют скрипты
 * страницы и видят их; для главной вдобавок есть статический снимок с теми же
 * тегами (`vite/seo-plugin.ts`) — на случай робота без JavaScript.
 */
export function usePageMeta({ description, path, language = 'ru', noindex = false }: PageMeta) {
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    if (description) {
      cleanups.push(setMeta('name', 'description', description));
      cleanups.push(setMeta('property', 'og:description', description));
    }
    cleanups.push(setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow'));

    if (path && !noindex) {
      const url = (lang: 'ru' | 'en') => `${SITE_URL}${path}${lang === 'en' ? '?lang=en' : ''}`;
      cleanups.push(setLink('canonical', url(language)));
      cleanups.push(setMeta('property', 'og:url', url(language)));
      cleanups.push(setLink('alternate', url('ru'), 'ru'));
      cleanups.push(setLink('alternate', url('en'), 'en'));
      cleanups.push(setLink('alternate', url('ru'), 'x-default'));
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [description, path, language, noindex]);
}

/**
 * Поставить мета-тег и вернуть откат к прежнему значению.
 *
 * Откат, а не удаление: базовые теги лежат в index.html, и страница, ушедшая
 * без своего описания, должна вернуть общее, а не оставить пустое место.
 */
function setMeta(attribute: 'name' | 'property', key: string, content: string): () => void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  const created = !element;
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  const previous = element.content;
  element.content = content;
  return () => {
    if (created) element.remove();
    else element.content = previous;
  };
}

function setLink(rel: 'canonical' | 'alternate', href: string, hreflang?: string): () => void {
  const selector = hreflang
    ? `link[rel="${rel}"][hreflang="${hreflang}"]`
    : `link[rel="${rel}"]:not([hreflang])`;
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  const created = !element;
  if (!element) {
    element = document.createElement('link');
    element.rel = rel;
    if (hreflang) element.hreflang = hreflang;
    document.head.append(element);
  }
  const previous = element.href;
  element.href = href;
  return () => {
    if (created) element.remove();
    else element.href = previous;
  };
}
