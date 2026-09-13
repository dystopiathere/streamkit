import { describe, expect, it } from 'vitest';
import { reconcileCookieChoice } from './cookie-consent';

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
