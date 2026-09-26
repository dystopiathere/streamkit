import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  type ActivateReferralDaysInput,
  activateReferralDaysSchema,
  type ReferralOverview,
} from '@streamkit/contracts';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser } from '../../common/auth/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ReferralsService } from './referrals.service';

// Жёсткий лимитер auth — только для входа и регистрации.
@SkipThrottle({ auth: true })
@Controller('referrals')
export class ReferralsController {
  constructor(
    private readonly referrals: ReferralsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async overview(@CurrentUser() user: AuthenticatedUser): Promise<ReferralOverview> {
    return this.referrals.overview(user.id);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(activateReferralDaysSchema)) body: ActivateReferralDaysInput,
    @Req() request: Request,
  ): Promise<ReferralOverview> {
    return this.referrals.activate(user.id, body.days, this.audit.contextFromRequest(request));
  }
}
