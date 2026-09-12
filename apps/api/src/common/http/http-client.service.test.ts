import { describe, expect, it } from 'vitest';
import { backoffMs, isRetryable, retryAfterMs } from './http-client.service';

describe('повтор запросов к площадке', () => {
  it('повторяет серверные ошибки', () => {
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(503)).toBe(true);
  });

  it('не повторяет ошибки запроса', () => {
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(404)).toBe(false);
  });

  it('не повторяет 429: «слишком часто» лечится паузой, а не повтором', () => {
    expect(isRetryable(429)).toBe(false);
  });
});

describe('задержка перед повтором', () => {
  it('растёт экспоненциально', () => {
    // Сравниваем при фиксированном джиттере, иначе диапазоны соседних попыток
    // перекрываются и утверждение становится неверным случайным образом.
    const fixed = () => 0.5;
    expect(backoffMs(1, fixed)).toBeLessThan(backoffMs(2, fixed));
    expect(backoffMs(2, fixed)).toBeLessThan(backoffMs(3, fixed));
  });

  it('разводит одновременные повторы джиттером', () => {
    // Без джиттера все каналы, упавшие в один тик опроса, повторятся строго
    // одновременно и добьют площадку ровно тогда, когда ей плохо.
    expect(backoffMs(1, () => 0)).not.toBe(backoffMs(1, () => 1));
  });

  it('держит задержку в разумных пределах', () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(backoffMs(attempt, () => 1)).toBeLessThanOrEqual(3000);
    }
  });
});

describe('заголовок Retry-After', () => {
  it('переводит секунды в миллисекунды', () => {
    expect(retryAfterMs('30')).toBe(30_000);
  });

  it('подставляет минуту, когда заголовка нет', () => {
    expect(retryAfterMs(null)).toBe(60_000);
  });

  it('не верит мусору и отрицательным значениям', () => {
    expect(retryAfterMs('скоро')).toBe(60_000);
    expect(retryAfterMs('-5')).toBe(60_000);
  });

  it('обрезает абсурдно долгое ожидание часом', () => {
    expect(retryAfterMs('86400')).toBe(3_600_000);
  });
});
