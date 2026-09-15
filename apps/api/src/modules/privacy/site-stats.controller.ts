import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  type SiteStatsConfig,
  type VisitorConsentInput,
  visitorConsentInputSchema,
} from '@streamkit/contracts';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { Public } from '../../common/auth/auth.decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AppConfig } from '../../config/app-config.service';
import { LEGAL_DOCUMENTS } from './legal-documents';

/**
 * Статистика посещений публичных страниц: настройки счётчика и журнал согласий
 * анонимных посетителей.
 *
 * Открыто без входа: главную, документы, вход и регистрацию смотрят люди без
 * учётной записи, и спросить их о статистике — единственный способ её вести.
 * Запись в аудит не делается намеренно: строка журнала согласия и есть
 * доказательство, а открытая ручка, пишущая две строки на запрос, — вдвое
 * дешевле для того, кто захочет раздуть базу.
 */
// Жёсткий лимитер auth — только для входа и регистрации; здесь свой, общий.
@SkipThrottle({ auth: true })
@Controller('public')
export class SiteStatsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('site-stats')
  settings(): SiteStatsConfig {
    return { umamiWebsiteId: this.config.umamiWebsiteId };
  }

  /** «Принять все» в баннере посетителя без учётной записи. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('site-stats/consent')
  async grant(
    @Body(zodBody(visitorConsentInputSchema)) body: VisitorConsentInput,
    @Req() request: Request,
  ): Promise<void> {
    const context = this.audit.contextFromRequest(request);
    await this.prisma.visitorConsent.create({
      data: {
        visitorId: body.visitorId,
        documentVersion: LEGAL_DOCUMENTS.COOKIE_ANALYTICS.version,
        ipHash: context.ipHash ?? null,
        userAgent: context.userAgent ?? null,
      },
    });
  }

  /** Отзыв: «Только необходимые» после ранее данного согласия. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('site-stats/consent/revoke')
  async revoke(@Body(zodBody(visitorConsentInputSchema)) body: VisitorConsentInput): Promise<void> {
    await this.prisma.visitorConsent.updateMany({
      where: { visitorId: body.visitorId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
