import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { StaffRole } from '@streamkit/contracts';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'streamkit:isPublic';
export const IS_ADMIN_API_KEY = 'streamkit:isAdminApi';
export const REQUIRED_ROLE_KEY = 'streamkit:requiredRole';

/**
 * Помечает ручку доступной без access-токена.
 *
 * Модель по умолчанию — «всё закрыто»: guard включён глобально, и открыть
 * эндпоинт можно только явным декоратором. Обратный вариант (закрывать по
 * одному) рано или поздно оставляет дыру.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Минимальная роль сотрудника для ручки админки.
 *
 * Без декоратора ручка требует `admin`: забытая пометка должна закрывать
 * лишнее, а не открывать его поддержке.
 */
export const RequireRole = (role: StaffRole): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLE_KEY, role);

export interface AuthenticatedUser {
  id: string;
  email: string;
}

/** Сотрудник, прошедший AdminGuard: роль прочитана из БД на этом запросе. */
export interface StaffUser extends AuthenticatedUser {
  role: StaffRole;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
  staff?: StaffUser;
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

/** `@CurrentStaff() staff: StaffUser` — сотрудник на ручке `@AdminApi()`. */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.staff) {
      throw new Error('CurrentStaff использован на маршруте без AdminGuard');
    }
    return request.staff;
  },
);
