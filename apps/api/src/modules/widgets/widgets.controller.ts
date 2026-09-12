import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  type CreatedOverlayToken,
  type CreateWidgetInput,
  createWidgetSchema,
  type OverlayTokenView,
  type UpdateWidgetInput,
  updateWidgetSchema,
  type Widget,
} from '@streamkit/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser } from '../../common/auth/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { WidgetsService } from './widgets.service';

const createTokenSchema = z.object({
  label: z.string().trim().max(80).nullable().default(null),
});

// Жёсткий лимитер auth предназначен только для входа и регистрации;
// на обычные ручки дашборда он не распространяется.
@SkipThrottle({ auth: true })
@Controller('widgets')
export class WidgetsController {
  constructor(
    private readonly widgets: WidgetsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<Widget[]> {
    return this.widgets.list(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createWidgetSchema)) body: CreateWidgetInput,
  ): Promise<Widget> {
    return this.widgets.create(user.id, body);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Widget> {
    return this.widgets.get(user.id, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateWidgetSchema)) body: UpdateWidgetInput,
  ): Promise<Widget> {
    return this.widgets.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.widgets.remove(user.id, id);
  }

  @Get(':id/tokens')
  async listTokens(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OverlayTokenView[]> {
    return this.widgets.listOverlayTokens(user.id, id);
  }

  /**
   * Ссылка возвращается целиком и только здесь. Повторно её показать нельзя —
   * в БД лежит хэш. Потерял ссылку — выпускай новую и отзывай старую.
   */
  @Post(':id/tokens')
  async createToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createTokenSchema)) body: { label: string | null },
    @Req() request: Request,
  ): Promise<CreatedOverlayToken> {
    return this.widgets.createOverlayToken(
      user.id,
      id,
      body.label,
      this.audit.contextFromRequest(request),
    );
  }

  @Delete(':id/tokens/:tokenId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.widgets.revokeOverlayToken(
      user.id,
      id,
      tokenId,
      this.audit.contextFromRequest(request),
    );
  }
}
