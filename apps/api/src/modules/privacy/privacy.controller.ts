import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConsentDocument } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser, Public } from '../../common/auth/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { LEGAL_DOCUMENTS } from './legal-documents';
import { type ConsentView, PrivacyService } from './privacy.service';

const consentSchema = z.object({
  document: z.nativeEnum(ConsentDocument),
});

const deleteAccountSchema = z.object({
  /** Подтверждение осознанности: пользователь вводит слово вручную. */
  confirmation: z.literal('УДАЛИТЬ'),
});

// Жёсткий лимитер auth предназначен только для входа и регистрации;
// на обычные ручки дашборда он не распространяется.
@SkipThrottle({ auth: true })
@Controller('privacy')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly audit: AuditService,
  ) {}

  /** Реестр документов и их версий. Нужен фронту для cookie-баннера и страниц /legal. */
  @Public()
  @Get('documents')
  documents() {
    return Object.values(LEGAL_DOCUMENTS);
  }

  @Get('consents')
  async consents(@CurrentUser() user: AuthenticatedUser): Promise<ConsentView[]> {
    return this.privacy.listConsents(user.id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('consents')
  async grant(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(consentSchema)) body: { document: ConsentDocument },
    @Req() request: Request,
  ): Promise<void> {
    await this.privacy.grant(user.id, body.document, this.audit.contextFromRequest(request));
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('consents/revoke')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(consentSchema)) body: { document: ConsentDocument },
    @Req() request: Request,
  ): Promise<void> {
    await this.privacy.revoke(user.id, body.document, this.audit.contextFromRequest(request));
  }

  /** Выгрузка всех данных пользователя одним JSON. */
  @Get('export')
  async exportData(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    return this.privacy.exportData(user.id, this.audit.contextFromRequest(request));
  }

  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(deleteAccountSchema)) _body: { confirmation: 'УДАЛИТЬ' },
    @Req() request: Request,
  ): Promise<void> {
    await this.privacy.anonymize(user.id, this.audit.contextFromRequest(request));
  }
}
