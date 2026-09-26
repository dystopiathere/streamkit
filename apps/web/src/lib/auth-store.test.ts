import type { PublicUser } from '@streamkit/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from './auth-store';
import { readCookieChoice, writeCookieChoice } from './cookie-consent';
import { queryClient } from './query-client';

function user(id: string): PublicUser {
  return {
    id,
    email: `${id.slice(-1)}@example.com`,
    displayName: 'Стример',
    isTotpEnabled: false,
    emailVerified: true,
    createdAt: new Date().toISOString(),
  };
}

const ALICE = user('00000000-0000-4000-8000-00000000000a');
const BOB = user('00000000-0000-4000-8000-00000000000b');

/**
 * Кэш запросов живёт ровно столько же, сколько сессия.
 *
 * Без этого журнал согласий предыдущего пользователя принимался баннером cookie
 * за согласие следующего, а виджеты и события с никами донатеров оставались на
 * экране у другого человека.
 */
describe('кэш запросов и сессия', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
  });

  it('выход чистит кэш', () => {
    useAuthStore.getState().setSession('token', ALICE);
    queryClient.setQueryData(['privacy', 'consents'], [{ document: 'COOKIE_ANALYTICS' }]);

    useAuthStore.getState().clearSession();

    expect(queryClient.getQueryData(['privacy', 'consents'])).toBeUndefined();
  });

  it('вход другим пользователем чистит кэш', () => {
    useAuthStore.getState().setSession('token', ALICE);
    queryClient.setQueryData(['widgets'], ['виджет Алисы']);

    useAuthStore.getState().setSession('token', BOB);

    expect(queryClient.getQueryData(['widgets'])).toBeUndefined();
  });

  it('обновление токена того же пользователя кэш не трогает', () => {
    useAuthStore.getState().setSession('token', ALICE);
    queryClient.setQueryData(['widgets'], ['виджет Алисы']);

    useAuthStore.getState().setSession('fresh-token', ALICE);

    expect(queryClient.getQueryData(['widgets'])).toEqual(['виджет Алисы']);
  });
});

describe('копия согласия на cookie и сессия', () => {
  it('выход стирает копию согласия: следующий человек за компьютером увидит баннер', () => {
    useAuthStore.getState().setSession('token', ALICE);
    writeCookieChoice('all');

    useAuthStore.getState().clearSession();

    expect(readCookieChoice()).toBeNull();
  });
});
