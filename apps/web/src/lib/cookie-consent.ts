import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'streamkit.cookie-choice';

export type CookieChoice = 'all' | 'necessary';

/** Документ согласия, которое даёт кнопка «Принять все». */
export const ANALYTICS_CONSENT = 'COOKIE_ANALYTICS';

/**
 * Выбор в баннере cookie — КЭШ журнала согласий, а не самостоятельная правда.
 *
 * Раньше он жил только в localStorage, а раздел «Приватность» читал журнал на
 * сервере, и эти два места никогда не сверялись: «Принять все» прятало баннер,
 * а в разделе стояло «Не принято». Для 152-ФЗ значение имеет именно журнал — в
 * нём версия документа, дата и отпечаток запроса, то есть доказательство
 * согласия. Локальная копия нужна лишь затем, чтобы баннер не мигал при каждой
 * загрузке страницы.
 */
const listeners = new Set<() => void>();

export function readCookieChoice(): CookieChoice | null {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'all' || stored === 'necessary' ? stored : null;
}

export function writeCookieChoice(value: CookieChoice | null): void {
  if (value === null) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, value);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Текущий выбор; компонент перерисуется, когда его поменяют где угодно. */
export function useCookieChoice(): CookieChoice | null {
  return useSyncExternalStore(subscribe, readCookieChoice, () => null);
}

/**
 * Как привести локальный выбор к журналу на сервере.
 *
 * @returns новое значение, либо `undefined` — менять ничего не нужно.
 *
 * Спорный случай один: в браузере «Принять все», а согласия в журнале нет.
 * Так бывает, если выбор сделан до этой сверки или запрос на запись не дошёл.
 * Он решается в пользу ПОВТОРНОГО ВОПРОСА, а не молчаливого согласия:
 * незаписанное согласие доказать нечем, и считать его данным нельзя.
 */
export function reconcileCookieChoice(
  local: CookieChoice | null,
  serverAccepted: boolean,
): CookieChoice | null | undefined {
  if (serverAccepted) return local === 'all' ? undefined : 'all';
  return local === 'all' ? null : undefined;
}
