import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  type AnalyticsQuery,
  analyticsQuerySchema,
  type AnalyticsSeries,
  type Channel,
  type ChannelSummary,
  type DonationTotal,
} from '@streamkit/contracts';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser } from '../../common/auth/auth.decorators';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';

// Жёсткий лимитер auth предназначен только для входа и регистрации;
// на ручки дашборда он не распространяется.
@SkipThrottle({ auth: true })
@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  @Get('channels')
  async listChannels(@CurrentUser() user: AuthenticatedUser): Promise<Channel[]> {
    return this.analytics.listChannels(user.id);
  }

  @Get('channels/:id/summary')
  async summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodQuery(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<ChannelSummary> {
    return this.analytics.summary(user.id, id, query.range);
  }

  @Get('channels/:id/series')
  async series(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodQuery(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<AnalyticsSeries> {
    return this.analytics.series(user.id, id, query.range);
  }

  /** Отключение площадки: канал, учётные данные и снимки метрик уходят вместе. */
  @Delete('channels/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.analytics.disconnect(user.id, id, this.audit.contextFromRequest(request));
  }

  /** Донаты за период. Отдельно от канала: они приходят не с площадки. */
  @Get('analytics/donations')
  async donations(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<DonationTotal[]> {
    return this.analytics.donations(user.id, query.range);
  }
}
