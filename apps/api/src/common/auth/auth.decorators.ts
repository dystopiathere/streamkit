import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'streamkit:isPublic';

/**
 * Помечает ручку доступной без access-токена.
 *
 * Модель по умолчанию — «всё закрыто»: guard включён глобально, и открыть
 * эндпоинт можно только явным декоратором. Обратный вариант (закрывать по
 * одному) рано или поздно оставляет дыру.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

/** `@CurrentUser() user: AuthenticatedUser` — данные из проверенного access-токена. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      // Сюда можно попасть только если декоратор использован на @Public-ручке.
      throw new Error('CurrentUser использован на маршруте без аутентификации');
    }
    return request.user;
  },
);
