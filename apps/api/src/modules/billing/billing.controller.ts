import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  type CheckoutInput,
  checkoutInputSchema,
  type CheckoutResult,
  type PaymentView,
  type SellerInfo,
  type SubscriptionView,
  type UpdateSubscriptionInput,
  updateSubscriptionSchema,
} from '@streamkit/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser, Public } from '../../common/auth/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AppConfig } from '../../config/app-config.service';
import { BillingService } from './billing.service';

/**
 * Реквизиты продавца для публичных страниц: главной, оферты и документов.
 *
 * Открыто без входа: ЮKassa проверяет сайт до подключения, и реквизиты, цены и
 * оферта должны быть видны любому посетителю.
 */
@SkipThrottle({ auth: true })
@Controller('public')
export class PublicSellerController {
  constructor(private readonly config: AppConfig) {}

  @Public()
  @Get('seller')
  seller(): SellerInfo {
    return this.config.seller;
  }
}

// Жёсткий лимитер auth — только для входа и регистрации.
@SkipThrottle({ auth: true })
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  @Get('subscription')
  async subscription(@CurrentUser() user: AuthenticatedUser): Promise<SubscriptionView> {
    return this.billing.subscription(user.id);
  }

  @Patch('subscription')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateSubscriptionSchema)) body: UpdateSubscriptionInput,
    @Req() request: Request,
  ): Promise<SubscriptionView> {
    return this.billing.update(user.id, body, this.audit.contextFromRequest(request));
  }

  /** Отвязать сохранённый способ оплаты: автопродление выключается вместе с ним. */
  @Delete('payment-method')
  async removePaymentMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<SubscriptionView> {
    return this.billing.removePaymentMethod(user.id, this.audit.contextFromRequest(request));
  }

  @Post('checkout')
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(checkoutInputSchema)) body: CheckoutInput,
    @Req() request: Request,
  ): Promise<CheckoutResult> {
    return this.billing.checkout(
      user.id,
      body.plan,
      body.period,
      this.audit.contextFromRequest(request),
    );
  }

  @Get('payments')
  async payments(@CurrentUser() user: AuthenticatedUser): Promise<PaymentView[]> {
    return this.billing.payments(user.id);
  }

  /** Страница «Тариф» опрашивает платёж по возвращении со страницы оплаты. */
  @Get('payments/:id')
  async payment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentView> {
    return this.billing.payment(user.id, id);
  }
}

/**
 * Уведомление ЮKassa. Разбирается только то, что нужно, чтобы найти платёж:
 * остальному содержимому мы не верим — уведомления не подписаны.
 */
const notificationSchema = z.object({
  type: z.literal('notification'),
  event: z.string(),
  object: z.object({
    id: z.string().min(1).max(64),
    // Есть только у возврата: платёж, по которому он сделан.
    payment_id: z.string().min(1).max(64).optional(),
  }),
});

/**
 * Уведомления ЮKassa о платежах.
 *
 * Без лимита запросов: уведомления идут с нескольких адресов ЮKassa пачками, и
 * отклонённое лимитом уведомление — это оплата, которая применится только
 * дочисткой через час. От перебора защищает то, что каждое уведомление — лишь
 * повод переспросить ЮKassa о платеже, который у нас уже есть в ожидании.
 */
@SkipThrottle({ default: true, auth: true })
@Controller('billing/yookassa')
export class YooKassaWebhookController {
  private readonly logger = new Logger(YooKassaWebhookController.name);

  constructor(private readonly billing: BillingService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(@Body() body: unknown): Promise<{ status: string }> {
    const parsed = notificationSchema.safeParse(body);
    // Мусор — 200, а не 400: ЮKassa повторяла бы его сутки, а исправить нечего.
    if (!parsed.success) return { status: 'ignored' };

    try {
      const { event, object } = parsed.data;
      if (event.startsWith('refund.')) {
        if (!object.payment_id) return { status: 'ignored' };
        return { status: await this.billing.handleRefundNotification(object.payment_id) };
      }
      return { status: await this.billing.handleNotification(object.id) };
    } catch (error) {
      // Свой сбой — ошибка, чтобы ЮKassa повторила: иначе оплаченный период
      // применился бы только дочисткой, и стример час смотрел бы на «не оплачено».
      this.logger.error({ err: error }, 'Не удалось обработать уведомление ЮKassa');
      throw new ServiceUnavailableException();
    }
  }
}
