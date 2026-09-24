import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import i18next, { type TFunction } from 'i18next';
import type { Plugin } from 'vite';
import {
  landingSnapshot,
  landingStructuredData,
  text,
} from '../src/features/public/landing-snapshot.ts';
import en from '../src/locales/en.json' with { type: 'json' };
import ru from '../src/locales/ru.json' with { type: 'json' };

/** Юридические документы, открытые для поиска: страницы `/legal/<slug>`. */
const LEGAL_SLUGS = ['terms', 'subscription', 'privacy', 'personal-data', 'cookies', 'room-guest'];

/**
 * Разделы кабинета: их обход закрыт в robots.txt. Список — корни маршрутов
 * `App.tsx` под `RequireAuth`, плюс вход, восстановление пароля и страница гостя.
 * `/sources`, `/billing` и `/privacy` — прежние адреса разделов профиля, теперь
 * переадресации: по ним ещё ходят ссылки из старых писем. `/privacy` не задевает
 * `/legal/privacy`: правило robots.txt — префикс пути от корня.
 */
const PRIVATE_PATHS = [
  '/stream',
  '/widgets',
  '/events',
  '/analytics',
  '/rooms',
  '/sources',
  '/account',
  '/billing',
  '/privacy',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/join',
  '/api/',
  '/u/',
];

function translator(language: 'ru' | 'en'): TFunction {
  const instance = i18next.createInstance();
  // Ресурсы переданы сразу, поэтому инициализация синхронная.
  void instance.init({
    lng: language,
    fallbackLng: 'ru',
    resources: { ru: { translation: ru }, en: { translation: en } },
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance.t;
}

/**
 * SEO-обвязка сборки дашборда.
 *
 * - общие теги в `<head>` каждой страницы: описание и карточка для соцсетей;
 * - `landing.html` — главная со статическим снимком содержимого, canonical,
 *   hreflang и schema.org; nginx отдаёт её на `/` вместо пустого `index.html`;
 * - `robots.txt` и `sitemap.xml` с тем же адресом сайта, что у canonical.
 *
 * Отдельный файл для главной, а не снимок в `index.html`: index.html уходит на
 * КАЖДЫЙ адрес SPA, и вошедший стример на полсекунды видел бы главную вместо
 * своего кабинета. Встроенный скрипт, который прятал бы снимок, закрыт CSP.
 */
export function seoPlugin(siteUrl: string): Plugin {
  const site = siteUrl.replace(/\/+$/, '');
  const t = translator('ru');
  let outDir = 'dist';
  let isBuild = false;

  return {
    name: 'streamkit-seo',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      isBuild = config.command === 'build';
    },

    transformIndexHtml(html) {
      const description = text(t('seo.home.description'));
      const tags = [
        `<meta name="description" content="${description}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="StreamKit" />`,
        `<meta property="og:title" content="StreamKit — ${text(t('seo.home.title'))}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:image" content="${site}/og-image.png" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        `<meta property="og:locale" content="ru_RU" />`,
        `<meta property="og:locale:alternate" content="en_US" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
      ];
      return html.replace(/\s*<\/head>/, `\n    ${tags.join('\n    ')}\n  </head>`);
    },

    closeBundle() {
      if (!isBuild) return;
      const index = readFileSync(join(outDir, 'index.html'), 'utf8');

      const title = `${text(t('seo.home.title'))} — StreamKit`;
      const head = [
        `<link rel="canonical" href="${site}/" />`,
        `<link rel="alternate" hreflang="ru" href="${site}/" />`,
        `<link rel="alternate" hreflang="en" href="${site}/?lang=en" />`,
        `<link rel="alternate" hreflang="x-default" href="${site}/" />`,
        `<meta property="og:url" content="${site}/" />`,
        `<script type="application/ld+json">${landingStructuredData(t, site)}</script>`,
      ];
      const landing = index
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${title}"`)
        .replace(/\s*<\/head>/, `\n    ${head.join('\n    ')}\n  </head>`)
        .replace('<div id="root"></div>', `<div id="root">${landingSnapshot(t)}</div>`);
      if (landing === index || !landing.includes(landingSnapshot(t))) {
        throw new Error('Снимок главной не встал в index.html: разметка корня изменилась');
      }
      writeFileSync(join(outDir, 'landing.html'), landing);

      writeFileSync(
        join(outDir, 'robots.txt'),
        [
          'User-agent: *',
          'Allow: /',
          ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`),
          '',
          `Sitemap: ${site}/sitemap.xml`,
          '',
        ].join('\n'),
      );

      const pages = ['/', '/register', ...LEGAL_SLUGS.map((slug) => `/legal/${slug}`)];
      const entry = (path: string) => {
        const ruUrl = `${site}${path}`;
        const enUrl = `${site}${path}?lang=en`;
        const alternates = [
          `<xhtml:link rel="alternate" hreflang="ru" href="${ruUrl}"/>`,
          `<xhtml:link rel="alternate" hreflang="en" href="${text(enUrl)}"/>`,
          `<xhtml:link rel="alternate" hreflang="x-default" href="${ruUrl}"/>`,
        ].join('');
        // Каждая языковая версия — своей записью со всеми альтернативами:
        // так Google требует описывать hreflang в sitemap.
        return [ruUrl, enUrl]
          .map((url) => `<url><loc>${text(url)}</loc>${alternates}</url>`)
          .join('\n  ');
      };
      writeFileSync(
        join(outDir, 'sitemap.xml'),
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n  ' +
          pages.map(entry).join('\n  ') +
          '\n</urlset>\n',
      );
    },
  };
}
