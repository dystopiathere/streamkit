import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Хэширование паролей. argon2id с параметрами, рекомендованными OWASP:
 * 19 МиБ памяти, 2 прохода, параллелизм 1.
 *
 * Берём `@node-rs/argon2`, а не `argon2`: у первого готовые бинарники под все
 * платформы, у второго сборка через node-gyp, которая регулярно ломает Windows и CI.
 */
@Injectable()
export class PasswordService {
  private readonly options = {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  async hash(password: string): Promise<string> {
    return hash(password, this.options);
  }

  /**
   * Проверка пароля. Любая ошибка формата хэша трактуется как «не совпало»:
   * различать «битый хэш» и «неверный пароль» снаружи нельзя, это утечка.
   */
  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password, this.options);
    } catch {
      return false;
    }
  }

  /**
   * Проверка по фиктивному хэшу — для случая, когда пользователя с таким email нет.
   *
   * Без неё ответ на несуществующий адрес приходит заметно быстрее (argon2 не
   * запускался), и логин превращается в оракул для перебора адресов. Хэш считается
   * один раз при первом обращении и переиспользуется.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('hex'));
    await this.verify(await this.dummyHash, password);
    return false;
  }

  private dummyHash: Promise<string> | null = null;
}
