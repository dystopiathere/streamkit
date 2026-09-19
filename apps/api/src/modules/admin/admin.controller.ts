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
  Query,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  type AdminAuditEntry,
  type AdminAuditQuery,
  adminAuditQuerySchema,
  type AdminChannel,
  type AdminChannelListQuery,
  adminChannelListQuerySchema,
  type AdminInvite,
  type AdminOverlayToken,
  type AdminPayment,
  type AdminPaymentListQuery,
  adminPaymentListQuerySchema,
  type AdminRoom,
  type AdminRoomListQuery,
  adminRoomListQuerySchema,
  adminSetWidgetEnabledSchema,
  type AdminStats,
  adminStatsQuerySchema,
  type AdminStatsRange,
  adminUpdateSubscriptionSchema,
  type AdminUserDetail,
  type AdminUserListQuery,
  adminUserListQuerySchema,
  type AdminUserRow,
  type AdminWidget,
  type AdminWidgetListQuery,
  adminWidgetListQuerySchema,
  type AnonymizeUserInput,
  anonymizeUserSchema,
  type ExtendSubscriptionInput,
  extendSubscriptionSchema,
  type Page,
  type PaymentView,
  type RevokeSessionsInput,
  revokeSessionsSchema,
  type SetUserRoleInput,
  setUserRoleSchema,
  type SubscriptionView,
  type SuspendUserInput,
  suspendUserSchema,
} from '@streamkit/contracts';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { AdminApi } from '../../common/auth/admin.guard';
import { CurrentStaff, RequireRole, type StaffUser } from '../../common/auth/auth.decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import { BillingService } from '../billing/billing.service';
import { AccountStatusService } from './account-status.service';
import { AdminObjectsService } from './admin-objects.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { staffContext } from './admin.mappers';

/**
 * Роли по ручкам.
 *
 * `support` смотрит и гасит доступы (сессии, ссылки, приглашения): это то, что
 * нужно по обращению «у меня украли ссылку». Всё, что меняет сам аккаунт,
 * деньги или права, — только `admin`. Ручка без пометки требует `admin`.
 */
@AdminApi()
@SkipThrottle({ auth: true })
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly status: AccountStatusService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  @RequireRole('support')
  @Get()
  list(
    @Query(zodQuery(adminUserListQuerySchema)) query: AdminUserListQuery,
  ): Promise<Page<AdminUserRow>> {
    return this.users.list(query);
  }

  @RequireRole('support')
  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<AdminUserDetail> {
    return this.users.detail(id, staffContext(this.audit, request, staff));
  }

  @RequireRole('support')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/sessions/revoke')
  revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(revokeSessionsSchema)) body: RevokeSessionsInput,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.status.revokeSessions(
      id,
      body.familyId,
      staff.role,
      staffContext(this.audit, request, staff),
    );
  }

  @RequireRole('support')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/totp/reset')
  resetTotp(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.status.resetTotp(id, staff.role, staffContext(this.audit, request, staff));
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/suspend')
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(suspendUserSchema)) body: SuspendUserInput,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.status.suspend(id, body.reason, staffContext(this.audit, request, staff));
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/restore')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.status.restore(id, staffContext(this.audit, request, staff));
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch(':id/role')
  setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(setUserRoleSchema)) body: SetUserRoleInput,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.status.setRole(id, body.role, staffContext(this.audit, request, staff));
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/anonymize')
  anonymize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(anonymizeUserSchema)) body: AnonymizeUserInput,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.status.anonymize(id, body.confirmEmail, staffContext(this.audit, request, staff));
  }

  /** Только выключение автопродления: включает его сам пользователь, своим согласием. */
  @Patch(':id/subscription')
  disableAutoRenew(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(adminUpdateSubscriptionSchema)) body: { autoRenew: false },
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<SubscriptionView> {
    return this.billing.update(
      id,
      { autoRenew: body.autoRenew },
      staffContext(this.audit, request, staff),
    );
  }

  @Post(':id/subscription/extend')
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(extendSubscriptionSchema)) body: ExtendSubscriptionInput,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<SubscriptionView> {
    return this.users.extendSubscription(
      id,
      body.days,
      staffContext(this.audit, request, staff, { reason: body.reason }),
    );
  }
}

@AdminApi()
@RequireRole('support')
@SkipThrottle({ auth: true })
@Controller('admin')
export class AdminObjectsController {
  constructor(
    private readonly objects: AdminObjectsService,
    private readonly stats: AdminStatsService,
    private readonly audit: AuditService,
  ) {}

  @Get('stats')
  platformStats(
    @Query(zodQuery(adminStatsQuerySchema)) query: { range: AdminStatsRange },
  ): Promise<AdminStats> {
    return this.stats.stats(query.range);
  }

  @Get('widgets')
  widgets(
    @Query(zodQuery(adminWidgetListQuerySchema)) query: AdminWidgetListQuery,
  ): Promise<Page<AdminWidget>> {
    return this.objects.listWidgets(query);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch('widgets/:id')
  setWidgetEnabled(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(adminSetWidgetEnabledSchema)) body: { isEnabled: boolean },
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.objects.setWidgetEnabled(
      id,
      body.isEnabled,
      staffContext(this.audit, request, staff),
    );
  }

  @Get('widgets/:id/tokens')
  tokens(@Param('id', ParseUUIDPipe) id: string): Promise<AdminOverlayToken[]> {
    return this.objects.listTokens(id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('widgets/:id/tokens/:tokenId')
  revokeToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.objects.revokeToken(id, tokenId, staffContext(this.audit, request, staff));
  }

  @HttpCode(HttpStatus.OK)
  @Post('widgets/:id/tokens/revoke-all')
  async revokeAllTokens(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<{ revoked: number }> {
    const revoked = await this.objects.revokeAllTokens(
      id,
      staffContext(this.audit, request, staff),
    );
    return { revoked };
  }

  @Get('rooms')
  rooms(
    @Query(zodQuery(adminRoomListQuerySchema)) query: AdminRoomListQuery,
  ): Promise<Page<AdminRoom>> {
    return this.objects.listRooms(query);
  }

  @Get('rooms/:id/invites')
  invites(@Param('id', ParseUUIDPipe) id: string): Promise<AdminInvite[]> {
    return this.objects.listInvites(id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('rooms/:id/invites/:inviteId')
  revokeInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.objects.revokeInvite(id, inviteId, staffContext(this.audit, request, staff));
  }

  @RequireRole('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('rooms/:id')
  removeRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.objects.removeRoom(id, staffContext(this.audit, request, staff));
  }

  @Get('channels')
  channels(
    @Query(zodQuery(adminChannelListQuerySchema)) query: AdminChannelListQuery,
  ): Promise<Page<AdminChannel>> {
    return this.objects.listChannels(query);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('channels/:id/resync')
  resync(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<void> {
    return this.objects.resyncChannel(id, staffContext(this.audit, request, staff));
  }

  @Get('payments')
  payments(
    @Query(zodQuery(adminPaymentListQuerySchema)) query: AdminPaymentListQuery,
  ): Promise<Page<AdminPayment>> {
    return this.objects.listPayments(query);
  }

  @HttpCode(HttpStatus.OK)
  @Post('payments/:id/sync')
  syncPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: StaffUser,
    @Req() request: Request,
  ): Promise<PaymentView> {
    return this.objects.syncPayment(id, staffContext(this.audit, request, staff));
  }

  /** Журнал целиком — только админу: в нём действия самой поддержки. */
  @RequireRole('admin')
  @Get('audit')
  auditLog(
    @Query(zodQuery(adminAuditQuerySchema)) query: AdminAuditQuery,
  ): Promise<Page<AdminAuditEntry>> {
    return this.objects.listAudit(query);
  }
}
