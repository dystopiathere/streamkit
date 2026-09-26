import { describe, expect, it } from 'vitest';
import { escapeHtml, type MailContent, renderMail } from './mail-layout';
import { mailUrl } from './mail-text';

const content: MailContent = {
  language: 'ru',
  subject: 'StreamKit: проверка',
  preheader: 'Строка превью',
  heading: 'Заголовок',
  greeting: 'Здравствуйте, <b>Стример</b> & Co!',
  blocks: [
    { kind: 'paragraph', text: 'Абзац "в кавычках"' },
    { kind: 'details', rows: [{ label: 'Когда', value: '26 сентября' }] },
    { kind: 'action', label: 'Открыть', url: 'https://stream-kit.ru/a?x=1&y=2' },
    { kind: 'notice', text: 'Если это были не вы' },
    {
      kind: 'links',
      items: [{ label: 'Оферта', url: 'https://stream-kit.ru/legal', note: 'от 1 октября' }],
    },
  ],
  footnote: 'Служебное письмо',
};

describe('вёрстка письма', () => {
  it('экранирует текст пользователя: имя не становится разметкой', () => {
    const { html } = renderMail(content);
    expect(html).not.toContain('<b>Стример</b>');
    expect(html).toContain('&lt;b&gt;Стример&lt;/b&gt; &amp; Co!');
    expect(html).toContain('Абзац &quot;в кавычках&quot;');
    expect(html).toContain('href="https://stream-kit.ru/a?x=1&amp;y=2"');
  });

  it('собрана для почтовых клиентов: таблицы, стили в атрибутах, Outlook, без картинок и скриптов', () => {
    const { html } = renderMail(content);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="ru"');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('bgcolor="#100f0d"');
    expect(html).toContain('name="color-scheme"');
    expect(html).not.toMatch(/<img|<script|<link|url\(/i);
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    // Без комментариев-пояснений: условные комментарии Outlook — единственные.
    const comments = html.match(/<!--(?!\[if mso\]|\[endif\])[\s\S]*?-->/g) ?? [];
    expect(comments.filter((comment) => !comment.startsWith('<![endif]'))).toEqual([]);
  });

  it('несёт текстовую версию того же содержимого', () => {
    const { text, subject } = renderMail(content);
    expect(subject).toBe('StreamKit: проверка');
    expect(text).toContain('Здравствуйте, <b>Стример</b> & Co!');
    expect(text).toContain('Когда: 26 сентября');
    expect(text).toContain('Открыть:\nhttps://stream-kit.ru/a?x=1&y=2');
    expect(text).toContain('Оферта (от 1 октября): https://stream-kit.ru/legal');
    expect(text).toContain('— Команда StreamKit');
    expect(text.trimEnd().endsWith('Служебное письмо')).toBe(true);
  });

  it('escapeHtml экранирует все пять символов', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });
});

describe('адрес страницы в письме', () => {
  it('английскому письму — английская страница, фрагмент сохраняется', () => {
    expect(mailUrl('https://stream-kit.ru/', '/account/security', 'ru')).toBe(
      'https://stream-kit.ru/account/security',
    );
    expect(mailUrl('https://stream-kit.ru', '/reset-password#token=abc', 'en')).toBe(
      'https://stream-kit.ru/reset-password?lang=en#token=abc',
    );
  });
});
