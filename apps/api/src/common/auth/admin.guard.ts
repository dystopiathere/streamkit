import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleAllows, type StaffRole } from '@streamkit/contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  IS_ADMIN_API_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_ROLE_KEY,
  type RequestWithUser,
} from './auth.decorators';

/**
 * Роль и статус сотрудника — из БД на каждый запрос.
 *
 * В токене роли нет намеренно: снятая роль должна действовать сразу, а не
 * через срок токена. Цена — один запрос по первичному ключу, а сотрудников
 * единицы.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    // Вход и обновление сессии админки открыты: сотрудника там ещё нет.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      // Глобальный guard уже отказал бы; сюда без пользователя попасть нельзя.
      throw new UnauthorizedException('Требуется авторизация');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { role: true, status: true, isTotpEnabled: true },
    });
    // Второй фактор — условие входа, а не только его шаг: выключенный в
    // дашборде, он закрывает и уже открытую сессию админки.
    if (!user || user.status !== 'ACTIVE' || user.role === 'USER' || !user.isTotpEnabled) {
      // 401, а не 403: сессии сотрудника больше нет, клиент уходит на вход.
      throw new UnauthorizedException('Доступ к админке закрыт');
    }

    const role = user.role === 'ADMIN' ? 'admin' : 'support';
    const required =
      this.reflector.getAllAndOverride<StaffRole>(REQUIRED_ROLE_KEY, targets) ?? 'admin';
    if (!roleAllows(role, required)) {
      throw new ForbiddenException('Недостаточно прав');
    }

    request.staff = { ...request.user, role };
    return true;
  }
}

/**
 * Контроллер админки: только админский токен и только сотрудник.
 *
 * Аудиторию токена проверяет глобальный guard по этой же метке, роль — AdminGuard.
 */
export const AdminApi = (): ClassDecorator =>
  applyDecorators(SetMetadata(IS_ADMIN_API_KEY, true), UseGuards(AdminGuard));
