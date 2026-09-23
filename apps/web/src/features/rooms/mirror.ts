import { useSyncExternalStore } from 'react';

/**
 * Зеркалить ли свою камеру. Выбор участника, а не настройка комнаты.
 *
 * Хранится в браузере, как и обработка микрофона: выбор описывает эту камеру на
 * этом компьютере, а у гостя нет учётной записи, куда его записать. Вернувшийся
 * по той же ссылке гость не выбирает заново.
 *
 * Остальным участникам и в кадр OBS выбор уходит атрибутом участника LiveKit
 * (`MIRROR_ATTRIBUTE` в contracts): зеркало действует одинаково везде, иначе
 * гость не знает, как его видят зрители.
 */
const STORAGE_KEY = 'streamkit.mirror-camera';
const listeners = new Set<() => void>();

// Прочитанное держится в памяти: `useSyncExternalStore` сравнивает снимки по
// ссылке. Заодно выбор действует до перезагрузки вкладки, даже когда хранилище
// закрыто (приватный режим, запрет сайта).
let current: boolean | null = null;

export function readMirrorCamera(): boolean {
  if (current !== null) return current;
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Хранилище закрыто (приватный режим, запрет сайта) — выбор будет жить в
    // памяти вкладки.
    stored = null;
  }
  // По умолчанию — без зеркала: в кадр идёт то, что снимает камера, пока
  // человек сам не решил иначе.
  current = stored === '1';
  return current;
}

export function writeMirrorCamera(value: boolean): void {
  current = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Не сохранилось — действует до перезагрузки вкладки, этого достаточно.
  }
  for (const listener of listeners) listener();
}

/** Для тестов: забыть прочитанное и перечитать хранилище. */
export function resetMirrorCameraCache(): void {
  current = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMirrorCamera(): boolean {
  return useSyncExternalStore(subscribe, readMirrorCamera, () => false);
}
