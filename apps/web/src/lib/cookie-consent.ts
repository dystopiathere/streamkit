import { VISITOR_CONSENT_TTL_DAYS } from '@streamkit/contracts';
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'streamkit.cookie-choice';
/** Когда сделан выбор: через год баннер спрашивает снова. */
const CHOSEN_AT_KEY = 'streamkit.cookie-choice-at';
const VISITOR_ID_KEY = 'streamkit.visitor-id';
const DAY_MS = 24 * 60 * 60 * 1000;

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

/**
 * Выбор старше года считается отсутствующим — баннер спросит снова.
 *
 * У посетителя без учётной записи нет раздела «Приватность», где он увидел бы
 * своё давнее согласие, и молча продлевать его бессрочно нельзя. У вошедшего
 * пользователя повторный вопрос не задаётся: сверка с журналом тут же вернёт
 * «Принять все», если согласие в журнале действует. Выбор без даты сделан до её
 * появления и считается действующим.
 */
export function readCookieChoice(now: number = Date.now()): CookieChoice | null {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored !== 'all' && stored !== 'necessary') return null;
  const chosenAt = Date.parse(window.localStorage.getItem(CHOSEN_AT_KEY) ?? '');
  if (Number.isFinite(chosenAt) && now - chosenAt > VISITOR_CONSENT_TTL_DAYS * DAY_MS) return null;
  return stored;
}

export function writeCookieChoice(value: CookieChoice | null): void {
  if (value === null) {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(CHOSEN_AT_KEY);
  } else if (value !== readCookieChoice()) {
    // Дата — только при смене действующего выбора: сверка с журналом пишет то
    // же значение при каждой загрузке и иначе продлевала бы срок бесконечно.
    // Истёкший выбор действующим не считается, и новый ответ дату обновит.
    window.localStorage.setItem(STORAGE_KEY, value);
    window.localStorage.setItem(CHOSEN_AT_KEY, new Date().toISOString());
  }
  for (const listener of listeners) listener();
}

/**
 * Случайный идентификатор этого браузера для журнала согласий посетителей.
 * Ни с учётной записью, ни со статистикой Umami он не связан.
 */
export function visitorId(): string {
  let id = window.localStorage.getItem(VISITOR_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_ID_KEY, id);
  }
  return id;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Текущий выбор; компонент перерисуется, когда его поменяют где угодно. */
export function useCookieChoice(): CookieChoice | null {
  return useSyncExternalStore(
    subscribe,
    () => readCookieChoice(),
    () => null,
  );
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
