import type { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_AUDIENCE,
  audienceOf,
  blockedUserKey,
  InvalidAccessToken,
  verifyAccessToken,
} from './access-token';

function deps(payload: object, blocked: string[] = []) {
  const jwt = { verifyAsync: async () => payload } as unknown as JwtService;
  const redis = {
    exists: async (key: string) => (blocked.includes(key) ? 1 : 0),
  } as unknown as Redis;
  return { jwt, redis };
}

describe('проверка access-токена', () => {
  it('токен без аудитории — токен дашборда: так выпускались все токены до админки', () => {
    expect(audienceOf({})).toBe('dashboard');
    expect(audienceOf({ aud: ADMIN_AUDIENCE })).toBe('admin');
    expect(audienceOf({ aud: ['other', ADMIN_AUDIENCE] })).toBe('admin');
  });

  it('аудитория должна совпасть с тем, куда токен предъявлен', async () => {
    const admin = deps({ sub: 'u1', email: 'a@b.ru', aud: ADMIN_AUDIENCE });
    await expect(
      verifyAccessToken(admin.jwt, admin.redis, 't', 'dashboard'),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
    await expect(verifyAccessToken(admin.jwt, admin.redis, 't', 'admin')).resolves.toMatchObject({
      sub: 'u1',
    });

    const dashboard = deps({ sub: 'u1', email: 'a@b.ru' });
    await expect(
      verifyAccessToken(dashboard.jwt, dashboard.redis, 't', 'admin'),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
  });

  it('заблокированный пользователь не проходит с ещё живым токеном', async () => {
    const blocked = deps({ sub: 'u1', email: 'a@b.ru' }, [blockedUserKey('u1')]);
    await expect(
      verifyAccessToken(blocked.jwt, blocked.redis, 't', 'dashboard'),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
  });

  it('поддельный токен — тот же отказ, что и чужой', async () => {
    const jwt = {
      verifyAsync: async () => {
        throw new Error('invalid signature');
      },
    } as unknown as JwtService;
    await expect(verifyAccessToken(jwt, deps({}).redis, 't', 'dashboard')).rejects.toBeInstanceOf(
      InvalidAccessToken,
    );
  });
});
