import { afterEach, describe, expect, it } from 'vitest';
import {
  readCookieChoice,
  reconcileCookieChoice,
  visitorId,
  writeCookieChoice,
} from './cookie-consent';

/**
 * Выбор в баннере — копия журнала согласий, а не самостоятельная правда.
 *
 * Раньше эти два места не сверялись вовсе: «Принять все» прятало баннер, а
 * раздел «Приватность» показывал «Не принято».
 */
describe('сверка выбора cookie с журналом', () => {
  it('согласие в журнале — в браузере «Принять все»', () => {
    expect(reconcileCookieChoice(null, true)).toBe('all');
    expect(reconcileCookieChoice('necessary', true)).toBe('all');
  });

  it('совпадающие состояния не трогает', () => {
    expect(reconcileCookieChoice('all', true)).toBeUndefined();
    expect(reconcileCookieChoice('necessary', false)).toBeUndefined();
    expect(reconcileCookieChoice(null, false)).toBeUndefined();
  });

  it('незаписанное согласие не считается данным — баннер спросит снова', () => {
    // Ровно то состояние, в которое попадал каждый, кто нажал «Принять все» до
    // исправления: в браузере согласие есть, в журнале нет. Доказать такое
    // согласие нечем, поэтому вопрос задаётся заново, а не молча засчитывается.
    expect(reconcileCookieChoice('all', false)).toBeNull();
  });
});

describe('срок выбора cookie и идентификатор посетителя', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  afterEach(() => window.localStorage.clear());

  it('выбор старше года считается отсутствующим — баннер спросит снова', () => {
    writeCookieChoice('all');
    expect(readCookieChoice()).toBe('all');
    expect(readCookieChoice(Date.now() + 366 * DAY_MS)).toBeNull();
  });

  it('повтор того же выбора не продлевает срок, новый ответ после истечения — продлевает', () => {
    writeCookieChoice('all');
    const chosenAt = window.localStorage.getItem('streamkit.cookie-choice-at');
    writeCookieChoice('all');
    expect(window.localStorage.getItem('streamkit.cookie-choice-at')).toBe(chosenAt);

    window.localStorage.setItem(
      'streamkit.cookie-choice-at',
      new Date(Date.now() - 400 * DAY_MS).toISOString(),
    );
    writeCookieChoice('all');
    expect(readCookieChoice()).toBe('all');
  });

  it('выбор без даты сделан до её появления и действует', () => {
    window.localStorage.setItem('streamkit.cookie-choice', 'necessary');
    expect(readCookieChoice()).toBe('necessary');
  });

  it('идентификатор посетителя случайный и постоянный для браузера', () => {
    const first = visitorId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(visitorId()).toBe(first);
  });
});
