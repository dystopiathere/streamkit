import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpClient } from '../../common/http/http-client.service';
import { RedisLock } from '../../common/redis/lock.service';
import {
  BillingController,
  PublicSellerController,
  YooKassaWebhookController,
} from './billing.controller';
import { BillingService } from './billing.service';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { YooKassaGateway } from './yookassa.gateway';

/** Подписка на платформу: оформление и уведомления — в API, продление — в воркере. */
@Module({
  controllers: [BillingController, YooKassaWebhookController, PublicSellerController],
  providers: [BillingService, HttpClient, { provide: PAYMENT_GATEWAY, useClass: YooKassaGateway }],
  exports: [BillingService],
})
export class BillingModule {}

const RENEWAL_LOCK_KEY = 'streamkit:lock:billing:renewal';

/**
 * Продления по расписанию.
 *
 * Под блокировкой, потому что расписание живёт в каждой реплике воркера. Но
 * двойное списание держится не на ней: блокировка может истечь посреди
 * медленного ответа ЮKassa, и тогда вторую попытку не пустит уникальность
 * `(subscriptionId, renewalFor, attempt)` в БД, а повтор запроса — ключ
 * идемпотентности. Блокировка здесь экономит запросы, а не деньги.
 */
@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(
    private readonly billing: BillingService,
    private readonly lock: RedisLock,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourly(): Promise<void> {
    try {
      await this.lock.withLock(RENEWAL_LOCK_KEY, 30 * 60 * 1000, async () => {
        await this.billing.reconcilePending();
        await this.billing.renewDue();
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Продление подписок завершилось ошибкой');
    }
  }
}

@Module({
  imports: [BillingModule],
  providers: [BillingScheduler],
})
export class BillingSchedulerModule {}
