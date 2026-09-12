import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.service';
import { CryptoService } from './crypto.service';

function createService(): CryptoService {
  const config = {
    encryptionKey: randomBytes(32),
    ipHashPepper: 'pepper-for-tests-0123456789',
    tokenHashPepper: 'token-pepper-for-tests-0123456789',
  } as AppConfig;
  return new CryptoService(config);
}

describe('CryptoService', () => {
  it('расшифровывает то, что зашифровал', () => {
    const crypto = createService();
    const secret = 'oauth-token-значение-с-юникодом';
    expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
  });

  it('даёт разный шифротекст при каждом вызове (случайный IV)', () => {
    const crypto = createService();
    expect(crypto.encrypt('one')).not.toBe(crypto.encrypt('one'));
  });

  it('отвергает подделанный шифротекст, а не возвращает мусор', () => {
    const crypto = createService();
    const encrypted = crypto.encrypt('важное значение');

    // Меняем один символ в base64-теле: GCM обязан поймать это по тегу.
    const body = encrypted.slice(3);
    const tampered = `v1.${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}`;

    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('отвергает шифротекст неизвестного формата', () => {
    const crypto = createService();
    expect(() => crypto.decrypt('v2.abc')).toThrow('Неизвестный формат');
    expect(() => crypto.decrypt('просто строка')).toThrow('Неизвестный формат');
  });

  it('не расшифровывает чужим ключом', () => {
    const encrypted = createService().encrypt('секрет');
    expect(() => createService().decrypt(encrypted)).toThrow();
  });

  it('хэширует токен детерминированно и не возвращает исходник', () => {
    const crypto = createService();
    const token = crypto.generateToken();
    const hash = crypto.hashToken(token);

    expect(crypto.hashToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
  });

  it('генерирует разные токены', () => {
    const crypto = createService();
    const tokens = new Set(Array.from({ length: 100 }, () => crypto.generateToken()));
    expect(tokens.size).toBe(100);
  });

  it('хэширует IP и возвращает null для пустого значения', () => {
    const crypto = createService();
    expect(crypto.hashIp('203.0.113.10')).toBe(crypto.hashIp('203.0.113.10'));
    expect(crypto.hashIp('203.0.113.10')).not.toBe(crypto.hashIp('203.0.113.11'));
    expect(crypto.hashIp(null)).toBeNull();
    expect(crypto.hashIp(undefined)).toBeNull();
  });

  it('сравнивает строки безопасно и корректно', () => {
    const crypto = createService();
    expect(crypto.safeCompare('abc', 'abc')).toBe(true);
    expect(crypto.safeCompare('abc', 'abd')).toBe(false);
    // Разная длина не должна ронять timingSafeEqual.
    expect(crypto.safeCompare('abc', 'abcd')).toBe(false);
    expect(crypto.safeCompare('', '')).toBe(true);
  });

  it('считает HMAC, зависящий и от секрета, и от тела', () => {
    const crypto = createService();
    const signature = crypto.hmacHex('secret', 'payload');

    expect(crypto.hmacHex('secret', 'payload')).toBe(signature);
    expect(crypto.hmacHex('other', 'payload')).not.toBe(signature);
    expect(crypto.hmacHex('secret', 'payload!')).not.toBe(signature);
  });
});
