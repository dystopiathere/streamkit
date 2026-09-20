import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { StreamOverview, StreamRefresh } from '@streamkit/contracts';
import { type AuthenticatedUser, CurrentUser } from '../../common/auth/auth.decorators';
import { StreamService } from './stream.service';

// Жёсткий лимитер auth — только для входа и регистрации.
@SkipThrottle({ auth: true })
@Controller('stream')
export class StreamController {
  constructor(private readonly stream: StreamService) {}

  @Get()
  async overview(@CurrentUser() user: AuthenticatedUser): Promise<StreamOverview> {
    return this.stream.overview(user.id);
  }

  /**
   * Ручной опрос площадок.
   *
   * POST, хотя ничего не создаёт: запрос ходит во внешние сервисы и списывает
   * квоту YouTube — повторять его при возврате «назад» или предзагрузкой
   * браузер не должен.
   */
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@CurrentUser() user: AuthenticatedUser): Promise<StreamRefresh> {
    return this.stream.refresh(user.id);
  }
}
