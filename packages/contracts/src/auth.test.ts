import { describe, expect, it } from 'vitest';
import { describeUserAgent, loginSchema } from './auth.js';

describe('describeUserAgent', () => {
  it('узнаёт браузер и систему, Edge — не Chrome', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      ),
    ).toBe('Edge, Windows');
    expect(
      describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'),
    ).toBe('Firefox, Linux');
  });

  it('ничего не узнав, возвращает null', () => {
    expect(describeUserAgent('curl/8.0')).toBeNull();
    expect(describeUserAgent(null)).toBeNull();
  });
});

describe('loginSchema', () => {
  it('принимает язык страницы и только из списка', () => {
    expect(loginSchema.parse({ email: 'a@b.ru', password: 'x', language: 'en' }).language).toBe(
      'en',
    );
    expect(loginSchema.safeParse({ email: 'a@b.ru', password: 'x', language: 'de' }).success).toBe(
      false,
    );
  });
});
