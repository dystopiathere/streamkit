import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { InvalidAccessToken, verifyAccessToken } from './access-token';
import { IS_ADMIN_API_KEY, IS_PUBLIC_KEY, type RequestWithUser } from './auth.decorators';

export type { AccessTokenPayload } from './access-token';

/**
 * Глобальный guard: без валидного access-токена не проходит ничего, кроме ручек,
 * явно помеченных `@Public()`.
 *
 * Токен должен быть выпущен для той части API, куда его предъявили: маршруты
 * `@AdminApi()` принимают только админский, остальные — только токен дашборда.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Требуется авторизация');
    }

    const isAdminApi = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_API_KEY, targets);
    try {
      const payload = await verifyAccessToken(
        this.jwt,
        this.redis,
        token,
        isAdminApi ? 'admin' : 'dashboard',
      );
      request.user = { id: payload.sub, email: payload.email };
      return true;
    } catch (error) {
      if (error instanceof InvalidAccessToken) {
        throw new UnauthorizedException('Недействительный токен');
      }
      throw error;
    }
  }
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}
