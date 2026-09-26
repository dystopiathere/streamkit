import { useEffect, useState } from 'react';

/**
 * Токен из фрагмента адреса — и сразу из адреса вон.
 *
 * Фрагмент не уходит на сервер и в Referer, но остаётся в истории браузера и
 * в адресной строке, откуда его унесёт снимок экрана. Читаем один раз при
 * открытии и заменяем адрес на чистый. Так устроены ссылки восстановления
 * пароля и подтверждения почты.
 */
export function useTokenFromFragment(): string | null {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  return token;
}
