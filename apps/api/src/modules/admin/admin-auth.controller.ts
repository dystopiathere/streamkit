import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  type AdminAuthResult,
  type AdminLoginInput,
  adminLoginSchema,
  type AdminMe,
} from '@streamkit/contracts';
import type { Request, Response } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { AdminApi } from '../../common/auth/admin.guard';
import {
  CurrentStaff,
  Public,
  RequireRole,
  type StaffUser,
} from '../../common/auth/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AppConfig } from '../../config/app-config.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../auth/refresh-cookie';
import { AdminAuthService } from './admin-auth.service';

/**
 * Вход в админку — отдельная сессия со своей cookie.
 *
 * Жёсткий лимитер `auth` — только на входе, как и в дашборде: обновление
 * токена за общим IP не должно упираться в лимит перебора паролей.
 */
@AdminApi()
@RequireRole('support')
@SkipThrottle({ auth: true })
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @SkipThrottle({ auth: false })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body(zodBody(adminLoginSchema)) body: AdminLoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminAuthResult> {
    const { refreshToken, ...result } = await this.auth.login(
      body,
      this.audit.contextFromRequest(request),
    );
    setRefreshCookie(response, refreshToken, this.config, 'ADMIN');
    return result;
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminAuthResult> {
    const raw = readRefreshCookie(request, 'ADMIN');
    if (!raw) throw new UnauthorizedException('Сессия недействительна');
    try {
      const { refreshToken, ...result } = await this.auth.refresh(
        raw,
        this.audit.contextFromRequest(request),
      );
      setRefreshCookie(response, refreshToken, this.config, 'ADMIN');
      return result;
    } catch (error) {
      clearRefreshCookie(response, this.config, 'ADMIN');
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
    await this.auth.logout(
      readRefreshCookie(request, 'ADMIN'),
      this.audit.contextFromRequest(request),
    );
    clearRefreshCookie(response, this.config, 'ADMIN');
  }

  @Get('me')
  me(@CurrentStaff() staff: StaffUser): Promise<AdminMe> {
    return this.auth.me(staff.id);
  }
}
