import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SITE_URL, usePageMeta } from './seo';

const head = (selector: string) => document.head.querySelector(selector);

describe('метаданные страницы', () => {
  it('публичная страница: описание, canonical своего языка и обе языковые версии', () => {
    const { unmount } = renderHook(() =>
      usePageMeta({ description: 'Описание', path: '/legal/terms', language: 'en' }),
    );

    expect(head('meta[name="description"]')?.getAttribute('content')).toBe('Описание');
    expect(head('meta[name="robots"]')?.getAttribute('content')).toBe('index, follow');
    // У английской версии canonical — она сама, а не русская: иначе поисковик
    // склеил бы их и английскую в выдачу не взял.
    expect(head('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${SITE_URL}/legal/terms?lang=en`,
    );
    expect(head('link[hreflang="ru"]')?.getAttribute('href')).toBe(`${SITE_URL}/legal/terms`);
    expect(head('link[hreflang="x-default"]')?.getAttribute('href')).toBe(
      `${SITE_URL}/legal/terms`,
    );

    // Ушли со страницы — её ссылки не должны достаться следующей.
    unmount();
    expect(head('link[rel="canonical"]')).toBeNull();
    expect(head('meta[name="description"]')).toBeNull();
  });

  it('кабинет закрыт от индексации и не объявляет canonical', () => {
    renderHook(() => usePageMeta({ noindex: true, path: '/widgets' }));

    expect(head('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
    expect(head('link[rel="canonical"]')).toBeNull();
  });

  it('общее описание из index.html возвращается, когда страница уходит', () => {
    const base = document.createElement('meta');
    base.name = 'description';
    base.content = 'Общее';
    document.head.append(base);

    const { unmount } = renderHook(() => usePageMeta({ description: 'Своё' }));
    expect(base.content).toBe('Своё');
    unmount();
    expect(base.content).toBe('Общее');
    base.remove();
  });
});
