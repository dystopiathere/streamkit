import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';

import { SkipThrottle } from '@nestjs/throttler';
import {
  type AuthResult,
  changePasswordSchema,
  enableTotpSchema,
  type LoginInput,
  loginSchema,
  type LoginResponse,
  type PublicUser,
  type RegisterInput,
  registerSchema,
  type SessionInfo,
} from '@streamkit/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser, Public } from '../../common/auth/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AppConfig } from '../../config/app-config.service';
import { AuthService } from './auth.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';
import { TokenService } from './token.service';

/**
 * Лимит запросов.
 *
 * Жёсткий лимитер `auth` (из конфигурации, десять в минуту на IP) стоит ТОЛЬКО на
 * ручках, где перебирают секрет: вход, регистрация, пароль и второй фактор.
 * Раньше он висел на всём контроллере, включая обновление токена, `me` и список
 * сессий. За общим IP — мобильный оператор с NAT на тысячи абонентов, офис,
 * общежитие — одиннадцатое обновление токена в минуту получало 429, клиент
 * считал сессию мёртвой и разлогинивал человека, который ничего не перебирал.
 * Остальные ручки — под общим лимитом, как весь дашборд.
 */
@SkipThrottle({ auth: true })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @SkipThrottle({ auth: false })
  @Post('register')
  async register(
    @Body(zodBody(registerSchema)) body: RegisterInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const context = this.audit.contextFromRequest(request);
    const { refreshToken, ...result } = await this.auth.register(body, context);
    this.issueRefreshCookie(response, refreshToken);
    return result;
  }

  @Public()
  @SkipThrottle({ auth: false })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body(zodBody(loginSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const context = this.audit.contextFromRequest(request);
    const outcome = await this.auth.login(body, context);

    if (outcome.status === 'totp-required' || !outcome.result) {
      return { totpRequired: true };
    }

    const { refreshToken, ...result } = outcome.result;
    this.issueRefreshCookie(response, refreshToken);
    return result;
  }

  /**
   * Обновление пары токенов. Refresh приходит только cookie — в теле запроса его
   * не принимаем, иначе появляется способ передать токен в обход httpOnly.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const raw = readRefreshCookie(request);
    if (!raw) {
      throw new UnauthorizedException('Сессия недействительна');
    }

    const context = this.audit.contextFromRequest(request);
    try {
      const { refreshToken, ...result } = await this.auth.refresh(raw, context);
      this.issueRefreshCookie(response, refreshToken);
      return result;
    } catch (error) {
      // Протухшая cookie только мешает: чистим, чтобы фронт сразу ушёл на логин.
      clearRefreshCookie(response, this.config);
      throw error;
    }
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const raw = readRefreshCookie(request);
    await this.auth.logout(raw, null, this.audit.contextFromRequest(request));
    clearRefreshCookie(response, this.config);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }

  @Get('sessions')
  async sessions(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<SessionInfo[]> {
    return this.tokens.listSessions(user.id, readRefreshCookie(request) ?? undefined);
  }

  /**
   * Завершение конкретной сессии: гасим всё семейство токенов устройства.
   *
   * Чужое семейство выглядит так же, как несуществующее — но отвечаем 404, а не
   * 401. Разница не косметическая: 401 клиент трактует как протухший access-токен,
   * идёт обновляться, получает 401 снова и разлогинивает пользователя. То есть
   * попытка удалить уже удалённую с другого устройства сессию выкидывала из
   * аккаунта.
   */
  @Delete('sessions/:familyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('familyId', ParseUUIDPipe) familyId: string,
  ): Promise<void> {
    const sessions = await this.tokens.listSessions(user.id);
    if (!sessions.some((session) => session.id === familyId)) {
      throw new NotFoundException('Сессия не найдена');
    }
    await this.tokens.revokeFamily(familyId);
  }

  @SkipThrottle({ auth: false })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(changePasswordSchema)) body: { currentPassword: string; newPassword: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
      this.audit.contextFromRequest(request),
    );
    clearRefreshCookie(response, this.config);
  }

  @Post('totp/setup')
  async setupTotp(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ secret: string; qrDataUrl: string }> {
    return this.auth.beginTotpSetup(user.id);
  }

  @SkipThrottle({ auth: false })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('totp/confirm')
  async confirmTotp(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(enableTotpSchema)) body: { code: string },
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.confirmTotpSetup(user.id, body.code, this.audit.contextFromRequest(request));
  }

  @SkipThrottle({ auth: false })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('totp/disable')
  async disableTotp(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ password: z.string().min(1).max(128) }))) body: { password: string },
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.disableTotp(user.id, body.password, this.audit.contextFromRequest(request));
  }

  private issueRefreshCookie(response: Response, token: string): void {
    setRefreshCookie(response, token, this.config);
  }
}
