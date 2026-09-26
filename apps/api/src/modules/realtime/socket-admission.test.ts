import type { IncomingMessage } from 'node:http';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { SocketAdmission, clientIp } from './socket-admission';

function request(remoteAddress: string, forwardedFor?: string): IncomingMessage {
  return {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
}

/** Redis с одним счётчиком на ключ; `failing` имитирует обрыв связи. */
function fakeRedis(failing = false): { redis: Redis; expires: string[] } {
  const counters = new Map<string, number>();
  const expires: string[] = [];
  const redis = {
    multi() {
      let key = '';
      const chain = {
        incr(k: string) {
          key = k;
          return chain;
        },
        expire(k: string, _ttl: number, mode: string) {
          expires.push(`${k}:${mode}`);
          return chain;
        },
        async exec() {
          if (failing) throw new Error('connection lost');
          const next = (counters.get(key) ?? 0) + 1;
          counters.set(key, next);
          return [
            [null, next],
            [null, 1],
          ];
        },
      };
      return chain;
    },
  } as unknown as Redis;
  return { redis, expires };
}

function ask(admission: SocketAdmission, req: IncomingMessage): Promise<boolean> {
  return new Promise((resolve) => admission.allowRequest(req, (_error, ok) => resolve(ok)));
}

describe('clientIp', () => {
  it('takes the address the proxy appended, not the one the client sent', () => {
    expect(clientIp(request('10.0.0.5', '6.6.6.6, 203.0.113.7'))).toBe('203.0.113.7');
  });

  it('falls back to the socket address without a proxy', () => {
    expect(clientIp(request('127.0.0.1'))).toBe('127.0.0.1');
  });
});

describe('SocketAdmission', () => {
  it('refuses handshakes over the per-minute limit, per address', async () => {
    const { redis, expires } = fakeRedis();
    const admission = new SocketAdmission(redis, { handshakesPerMinute: 2, connectionsPerIp: 100 });
    const flood = request('10.0.0.5', '203.0.113.7');

    expect(await ask(admission, flood)).toBe(true);
    expect(await ask(admission, flood)).toBe(true);
    expect(await ask(admission, flood)).toBe(false);
    expect(await ask(admission, request('10.0.0.5', '198.51.100.1'))).toBe(true);
    expect(expires.every((entry) => entry.endsWith(':NX'))).toBe(true);
  });

  it('refuses a new socket while the address holds its limit of open ones', async () => {
    const { redis } = fakeRedis();
    const admission = new SocketAdmission(redis, { handshakesPerMinute: 100, connectionsPerIp: 2 });
    const req = request('10.0.0.5', '203.0.113.7');

    const closeFirst = admission.opened(req);
    admission.opened(req);
    expect(await ask(admission, req)).toBe(false);

    closeFirst();
    closeFirst();
    expect(admission.openFrom('203.0.113.7')).toBe(1);
    expect(await ask(admission, req)).toBe(true);
  });

  it('lets connections through when Redis is unavailable', async () => {
    const { redis } = fakeRedis(true);
    const admission = new SocketAdmission(redis, { handshakesPerMinute: 1, connectionsPerIp: 100 });

    expect(await ask(admission, request('127.0.0.1'))).toBe(true);
  });
});
