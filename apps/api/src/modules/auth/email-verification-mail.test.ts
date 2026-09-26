import { describe, expect, it } from 'vitest';
import { emailVerificationMessage } from './email-verification-mail';

const LINK = 'https://stream-kit.ru/verify-email#token=abc';

describe('письмо подтверждения почты', () => {
  it('ведёт по ссылке, называет срок и говорит, что делать, если регистрировались не вы', () => {
    const letter = emailVerificationMessage({
      email: 'a@example.com',
      displayName: '<b>Стример</b>',
      link: LINK,
      language: 'ru',
    });
    expect(letter.to).toBe('a@example.com');
    expect(letter.subject).toBe('StreamKit: подтвердите почту');
    expect(letter.html).toContain(`href="${LINK}"`);
    expect(letter.text).toContain(LINK);
    expect(letter.text).toContain('24 часа');
    expect(letter.text).toContain('просто удалите письмо');
    expect(letter.html).not.toContain('<b>Стример</b>');
  });

  it('по-английски', () => {
    const letter = emailVerificationMessage({
      email: 'a@example.com',
      displayName: 'Streamer',
      link: LINK,
      language: 'en',
    });
    expect(letter.subject).toBe('StreamKit: confirm your email');
    expect(letter.html).toContain('lang="en"');
    expect(letter.text).toContain('24 hours');
  });
});
