import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type Payment, Prisma, type Plan as PrismaPlan, type Subscription } from '@prisma/client';
import {
  type BillingPeriod,
  type CheckoutResult,
  GRACE_DAYS,
  mailLanguageSchema,
  MAX_RENEWAL_ATTEMPTS,
  type PaidPlan,
  type PaymentView,
  PLAN_FEATURES,
  type PlanFeatures,
  PLAN_PRICES,
  type SubscriptionView,
} from '@streamkit/contracts';
import { AuditService, type AuditContext } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PlatformError } from '../../common/http/platform-errors';
import { MAILER, type Mailer } from '../../common/mail/mailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { LEGAL_DOCUMENTS } from '../privacy/legal-documents';
import {
  addBillingPeriod,
  DAY_MS,
  effectivePlan,
  subscriptionStatus,
  toContractPeriod,
  toContractPlan,
  toPrismaPeriod,
  toPrismaPlan,
} from './billing-periods';
import { PAYMENT_GATEWAY, type PaymentGateway, type ProviderPayment } from './payment-gateway';
import { expiryNoticeMessage, renewalNoticeMessage } from './renewal-notice';

/** За сколько до конца периода начинаем списывать продление. */
const RENEW_AHEAD_MS = DAY_MS;

/** Сколько проходит между письмом о списании и самим списанием — п. 5 оферты. */
const NOTICE_LEAD_MS = 3 * DAY_MS;

/** Письмо уходит так, чтобы три дня истекли как раз к началу окна списания. */
const NOTICE_AHEAD_MS = RENEW_AHEAD_MS + NOTICE_LEAD_MS;

/**
 * Граница, отделяющая письмо о ТЕКУЩЕМ конце периода от письма о прошлом.
 *
 * Сравнить `renewalNoticeFor` с `currentPeriodEnd` в одном запросе Prisma не
 * умеет, но и не нужно. Письмо о текущем конце отмечено датой этого конца, а
 * она не раньше, чем «сейчас минус льготные дни». Прошлый конец периода — это
 * минимум месяц назад. Неделя лежит между ними с запасом в обе стороны.
 */
const STALE_NOTICE_MS = 7 * DAY_MS;

/**
 * Отказы, после которых повторять списание бессмысленно: способ оплаты мёртв или
 * доступ к нему отозван. Повтор по такой карте — это ещё одно отклонение в
 * истории магазина, а у эквайринга на этот счёт своя статистика.
 */
const TERMINAL_DECLINES = new Set([
  'permission_revoked',
  'card_expired',
  'invalid_card_number',
  'payment_method_restricted',
  'fraud_suspected',
]);

/**
 * Продление без идентификатора у ЮKassa дольше этого — отменяем и разбираем
 * руками. Ключ идемпотентности ЮKassa живёт сутки: после них повтор с тем же
 * ключом уже не узнает прежний платёж и мог бы списать второй раз.
 */
const UNCONFIRMED_RENEWAL_TTL_MS = 20 * 60 * 60 * 1000;

/**
 * Отказы ЮKassa, которые говорят о нашем магазине, а не о карте стримера:
 * неверные ключи, не подключённые автоплатежи, слишком частые запросы.
 */
const OUR_SIDE_REJECTIONS = new Set([401, 403, 429]);

/** Через сколько повторить продление, отложенное из-за отказа магазину. */
const OUR_SIDE_RETRY_MS = 60 * 60 * 1000;

/** Тариф закрыт: 402 с кодом, по которому интерфейс показывает, где его купить. */
export class SubscriptionRequiredException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'subscription_required',
        message: 'Приватные комнаты доступны в тарифе «Про»',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Подписка на платформу: оформление, применение платежей, продление.
 *
 * Деньги здесь двигаются в одну сторону — от стримера платформе, — и вся
 * опасность в двух местах: списать дважды и продлить дважды. От первого
 * защищают ключ идемпотентности у ЮKassa и уникальность попытки продления в БД,
 * от второго — условный переход платежа из PENDING в транзакции с продлением.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  get configured(): boolean {
    return this.config.billing !== null;
  }

  async subscription(userId: string, now = new Date()): Promise<SubscriptionView> {
    const row = await this.prisma.subscription.findUnique({ where: { userId } });
    const status = subscriptionStatus(row, now);
    const features = await this.planFeatures(userId, now);
    return {
      status,
      plan: effectivePlan(row, now),
      // Тариф следующего периода отдаём, только пока есть что продлевать:
      // у истёкшей подписки «продлится Про» — обещание, которого нет. Пустой
      // `nextPlan` значит «сменить не просили», то есть продлится текущий.
      nextPlan: row && status !== 'expired' ? toContractPlan(row.nextPlan ?? row.plan) : null,
      features,
      period: row ? toContractPeriod(row.period) : null,
      currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
      autoRenew: row?.autoRenew ?? false,
      renewalAmount: row
        ? { amountMinor: row.renewalAmountMinor, currency: row.renewalCurrency as 'RUB' }
        : null,
      paymentMethodTitle: row?.paymentMethodTitle ?? null,
      giftedDays: row?.giftedDays ?? 0,
      roomsAccess: features.rooms,
      billingConfigured: this.configured,
    };
  }

  /**
   * Что доступно владельцу прямо сейчас.
   *
   * Одна точка на все гейты: лимит виджетов, число площадок, комнаты,
   * продвинутое оформление. Считает сервер, а не клиент, из-за двух особых
   * случаев, которые из названия тарифа не выводятся.
   *
   * Без настроенной оплаты открыто всё: так в разработке и в самостоятельной
   * установке, где продавать некому. Заблокированному аккаунту закрыты
   * комнаты — гость и оверлей получают отказ при входе, а вебхук выгоняет
   * вошедших раньше; остальное блокировка гасит своими средствами.
   */
  async planFeatures(userId: string, now = new Date()): Promise<PlanFeatures> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        subscription: { select: { plan: true, currentPeriodEnd: true, autoRenew: true } },
      },
    });
    if (!user) return PLAN_FEATURES.free;
    if (!this.configured) {
      return { ...PLAN_FEATURES.pro, rooms: user.status === 'ACTIVE' };
    }

    const features = PLAN_FEATURES[effectivePlan(user.subscription, now)];
    return user.status === 'ACTIVE' ? features : { ...features, rooms: false };
  }

  /** Открыты ли приватные комнаты владельцу. */
  async roomsAccess(userId: string, now = new Date()): Promise<boolean> {
    return (await this.planFeatures(userId, now)).rooms;
  }

  async requireRoomsAccess(userId: string): Promise<void> {
    if (!(await this.roomsAccess(userId))) throw new SubscriptionRequiredException();
  }

  async payments(userId: string): Promise<PaymentView[]> {
    const rows = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toPaymentView);
  }

  /**
   * Платёж по возвращении со страницы оплаты.
   *
   * Уведомление ЮKassa может прийти позже, чем браузер вернётся, поэтому
   * незакрытый платёж переспрашивается здесь же. Сбой переспроса не ошибка для
   * пользователя: он увидит «обрабатывается», а доведёт дело уведомление.
   */
  async payment(userId: string, paymentId: string): Promise<PaymentView> {
    const row = await this.prisma.payment.findFirst({ where: { id: paymentId, userId } });
    if (!row) throw new NotFoundException('Платёж не найден');
    if (row.status !== 'PENDING' || !row.providerPaymentId) return toPaymentView(row);

    try {
      await this.syncPayment(row);
    } catch (error) {
      this.logger.warn({ err: error, paymentId }, 'Не удалось переспросить платёж');
    }
    return toPaymentView(await this.prisma.payment.findUniqueOrThrow({ where: { id: row.id } }));
  }

  /**
   * Оформление подписки: платёж, согласие в журнал, страница оплаты.
   *
   * Согласие пишется ДО запроса к ЮKassa: сохранение способа оплаты для
   * автоматических списаний — ровно то, на что оно дано.
   */
  async checkout(
    userId: string,
    plan: PaidPlan,
    period: BillingPeriod,
    context: AuditContext = {},
  ): Promise<CheckoutResult> {
    if (!this.configured) throw new ServiceUnavailableException('Оплата не настроена');

    const now = new Date();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const existing = await this.prisma.subscription.findUnique({ where: { userId } });
    // Следующий период поверх действующего приходит продлением, а не отдельной
    // оплатой: так у подписки один источник продлений и один способ оплаты.
    // Смена тарифа действующей подписки — тоже не оплата, а выбор тарифа
    // следующего периода (`update`): доплат и пересчёта остатка у нас нет.
    //
    // Исключение — льготные дни: списание по сохранённой карте не прошло, и
    // оплата другой картой — единственный способ её заменить, не теряя доступ.
    // Период к этому моменту уже кончился, поэтому это не доплата поверх
    // оплаченного, а та же оплата следующего периода, что и продление.
    const grace = subscriptionStatus(existing, now) === 'grace';
    if (effectivePlan(existing, now) !== 'free' && !grace) {
      throw new ConflictException('Подписка уже действует');
    }

    const price = PLAN_PRICES[plan][period];
    const payment = await this.prisma.$transaction(async (tx) => {
      if (grace && existing) {
        // Под блокировкой строки подписки — той же, что берёт продление: иначе
        // повтор списания по старой карте и эта оплата прошли бы оба, и
        // стример заплатил бы за один период дважды.
        await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${existing.id}::uuid FOR UPDATE`;
        const renewing = await tx.payment.count({
          where: { subscriptionId: existing.id, kind: 'RENEWAL', status: 'PENDING' },
        });
        if (renewing > 0) {
          throw new ConflictException(
            'Списание по сохранённой карте ещё обрабатывается — попробуйте через несколько минут',
          );
        }
        await tx.consent.create({
          data: {
            userId,
            document: 'SUBSCRIPTION_OFFER',
            documentVersion: LEGAL_DOCUMENTS.SUBSCRIPTION_OFFER.version,
            ipHash: context.ipHash ?? null,
            userAgent: context.userAgent ?? null,
          },
        });
        // Подписка до оплаты НЕ меняется: в льготные дни её тариф действует, и
        // выбор «Про» в неоплаченной форме открыл бы «Про» бесплатно, а новая
        // цена ушла бы в повтор списания по старой карте без письма о ней.
        // Тариф, период и цену продления применяет успешный платёж.
        return tx.payment.create({
          data: {
            userId,
            subscriptionId: existing.id,
            kind: 'INITIAL',
            plan: toPrismaPlan(plan),
            period: toPrismaPeriod(period),
            amountMinor: price.amountMinor,
            currency: price.currency,
          },
        });
      }

      // Тариф и цена продления фиксируются здесь же: по ним будут списываться
      // следующие периоды, пока стример сам их не сменит.
      const renewal = {
        plan: toPrismaPlan(plan),
        // Оплата отменяет прежний выбор тарифа на следующий период: стример
        // только что выбрал заново, и продлевать надо оплаченное.
        nextPlan: null,
        period: toPrismaPeriod(period),
        renewalAmountMinor: price.amountMinor,
        renewalCurrency: price.currency,
      };
      const subscription = await tx.subscription.upsert({
        where: { userId },
        create: { userId, ...renewal },
        update: {
          ...renewal,
          // Сюда попадает только кончившаяся подписка, но автопродление у неё
          // может быть ещё включено, а письмо о списании — свежим. С новыми
          // тарифом и ценой это письмо называло бы чужую сумму, и брошенная
          // страница оплаты превратилась бы в списание по старой карте по
          // новой цене без предупреждения. Автопродление вернёт оплата.
          autoRenew: false,
          renewalFailures: 0,
          nextRenewalAttemptAt: null,
          renewalNoticeFor: null,
          renewalNoticeSentAt: null,
        },
      });
      await tx.consent.create({
        data: {
          userId,
          document: 'SUBSCRIPTION_OFFER',
          documentVersion: LEGAL_DOCUMENTS.SUBSCRIPTION_OFFER.version,
          ipHash: context.ipHash ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
      return tx.payment.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          kind: 'INITIAL',
          plan: toPrismaPlan(plan),
          period: toPrismaPeriod(period),
          amountMinor: price.amountMinor,
          currency: price.currency,
        },
      });
    });

    let provider: ProviderPayment;
    try {
      provider = await this.gateway.createPayment({
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        description: describe(plan, period),
        customerEmail: user.email,
        returnUrl: `${this.config.webBaseUrl.replace(/\/+$/, '')}/account/billing?payment=${payment.id}`,
      });
    } catch (error) {
      const rejected = error instanceof PlatformError && error.status >= 400 && error.status < 500;
      this.logger.error(
        {
          err: error,
          paymentId: payment.id,
          ...(error instanceof PlatformError
            ? { status: error.status, provider: error.providerError }
            : {}),
        },
        'ЮKassa не создала платёж',
      );
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'PENDING', providerPaymentId: null },
        data: {
          status: 'CANCELED',
          cancellationReason: rejected ? 'gateway_rejected' : 'gateway_error',
        },
      });
      // Отказ ЮKassa — не «не ответил»: повтор получит тот же отказ, и совет
      // «попробуйте ещё раз» только гоняет человека по кругу.
      throw new ServiceUnavailableException(
        rejected
          ? 'Оплата сейчас недоступна: платёжный сервис отклонил запрос. Мы уже разбираемся — попробуйте позже.'
          : 'Платёжный сервис не ответил. Попробуйте ещё раз.',
      );
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerPaymentId: provider.id },
    });
    await this.audit.record('billing.checkout.created', userId, {
      ...context,
      metadata: { paymentId: payment.id, plan, period },
    });

    if (!provider.confirmationUrl) {
      throw new ServiceUnavailableException('Платёжный сервис не вернул страницу оплаты');
    }
    return { paymentId: payment.id, confirmationUrl: provider.confirmationUrl };
  }

  /**
   * Уведомление ЮKassa.
   *
   * Уведомления НЕ подписаны, поэтому тело — только повод спросить. Спрашиваем
   * лишь про платёж, который у нас есть и ещё не закрыт: иначе открытый
   * эндпоинт превращался бы в усилитель запросов к ЮKassa на наши ключи.
   *
   * @returns что сделано — для ответа и тестов. Сбой переспроса пробрасывается:
   *          ЮKassa повторит уведомление, только если получит ошибку.
   */
  async handleNotification(providerPaymentId: string): Promise<'processed' | 'ignored'> {
    if (!this.configured) return 'ignored';
    const row = await this.prisma.payment.findUnique({ where: { providerPaymentId } });
    if (!row || row.status !== 'PENDING') return 'ignored';
    await this.syncPayment(row);
    return 'processed';
  }

  /**
   * Уведомление о возврате.
   *
   * Тело уведомления не подписано, как и у платежей, поэтому из него берётся
   * только идентификатор платежа — и только оплаченного, который есть у нас:
   * иначе открытый эндпоинт гонял бы запросы к ЮKassa по любым присланным
   * строкам. Сумма возврата — итог по платежу из ЮKassa, а не из тела.
   *
   * Любой возврат по платежу ТЕКУЩЕГО периода прекращает доступ сразу и
   * выключает автопродление: возврат делается за неиспользованные дни (п. 7
   * оферты), и оставлять доступ к оплаченному обратно периоду нельзя.
   */
  async handleRefundNotification(providerPaymentId: string): Promise<'processed' | 'ignored'> {
    if (!this.configured) return 'ignored';
    const row = await this.prisma.payment.findUnique({ where: { providerPaymentId } });
    if (!row || row.status !== 'SUCCEEDED') return 'ignored';

    const refunded = await this.gateway.refundedAmount(providerPaymentId);
    if (refunded.amountMinor === row.refundedAmountMinor) return 'ignored';
    if (refunded.amountMinor > row.amountMinor || refunded.currency !== row.currency) {
      this.logger.error({ paymentId: row.id }, 'Возврат больше платежа или в другой валюте');
      await this.audit.record('billing.payment.amount_mismatch', row.userId, {
        metadata: { paymentId: row.id, refund: true },
      });
      return 'ignored';
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: row.id },
        data: { refundedAmountMinor: refunded.amountMinor, refundedAt: now },
      });
      if (!row.subscriptionId || refunded.amountMinor === 0) return;

      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${row.subscriptionId}::uuid FOR UPDATE`;
      // Текущий — последний оплаченный период, который ещё не кончился. Раньше
      // его узнавали по равенству конца платежа и конца подписки, но конец
      // подписки двигают и подарочные дни: месяц с подарком поверх после
      // возврата оставался открытым целиком. Продление, списанное позже,
      // — уже следующий период: возврат прошлого его не закрывает.
      if (!row.periodEnd || row.periodEnd <= now) return;
      const later = await tx.payment.count({
        where: {
          subscriptionId: row.subscriptionId,
          status: 'SUCCEEDED',
          id: { not: row.id },
          periodEnd: { gt: row.periodEnd },
        },
      });
      if (later > 0) return;

      await tx.subscription.update({
        where: { id: row.subscriptionId },
        data: {
          // Подарочные дни поверх возвращённого периода уходят вместе с ним:
          // они продлевали доступ, за который деньги вернулись.
          currentPeriodEnd: now,
          giftedDays: 0,
          autoRenew: false,
          renewalNoticeFor: null,
          renewalNoticeSentAt: null,
        },
      });
      await tx.consent.updateMany({
        where: { userId: row.userId, document: 'SUBSCRIPTION_OFFER', revokedAt: null },
        data: { revokedAt: now },
      });
    });

    await this.audit.record('billing.payment.refunded', row.userId, {
      metadata: { paymentId: row.id, refundedAmountMinor: refunded.amountMinor },
    });
    return 'processed';
  }

  /** Переспросить платёж у ЮKassa и применить ответ. */
  async syncPayment(row: Payment): Promise<void> {
    if (!row.providerPaymentId) return;
    const provider = await this.gateway.getPayment(row.providerPaymentId);
    await this.applyProviderPayment(row, provider);
  }

  /**
   * Применить ответ ЮKassa к нашему платежу. Идемпотентно: повтор уведомления,
   * возврат пользователя и такт воркера продлевают подписку ровно один раз.
   */
  async applyProviderPayment(row: Payment, provider: ProviderPayment): Promise<void> {
    if (provider.status === 'succeeded') {
      // Сумма сверяется с нашей записью, а не принимается на веру: платёж на
      // рубль вместо месяца не должен продлевать месяц, чем бы ни объяснялось
      // расхождение.
      if (
        provider.amountMinor !== row.amountMinor ||
        provider.currency !== row.currency ||
        (provider.paymentId !== null && provider.paymentId !== row.id)
      ) {
        this.logger.error(
          { paymentId: row.id, providerPaymentId: provider.id },
          'Сумма или привязка платежа не совпадает с записью — не продлеваем',
        );
        await this.audit.record('billing.payment.amount_mismatch', row.userId, {
          metadata: { paymentId: row.id, providerPaymentId: provider.id },
        });
        return;
      }
      if (await this.markSucceeded(row, provider)) {
        await this.audit.record('billing.payment.succeeded', row.userId, {
          metadata: { paymentId: row.id, kind: row.kind },
        });
      }
      return;
    }

    if (provider.status === 'canceled') {
      const claimed = await this.prisma.payment.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: {
          status: 'CANCELED',
          cancellationReason: (provider.cancellationReason ?? 'unknown').slice(0, 80),
        },
      });
      if (claimed.count === 0) return;
      await this.audit.record('billing.payment.canceled', row.userId, {
        metadata: { paymentId: row.id, reason: provider.cancellationReason },
      });
      if (row.kind === 'RENEWAL' && row.subscriptionId) {
        await this.recordRenewalFailure(row.subscriptionId, provider.cancellationReason);
      }
    }
    // pending и waiting_for_capture — ждём. Холда у нас нет (capture: true),
    // так что второе встретиться не должно, но и продлевать по нему нельзя.
  }

  /**
   * Правка подписки: автопродление и период следующего продления.
   *
   * Выключение автопродления — отзыв согласия на списания, и в журнале тоже.
   * Включение — новое согласие: молча списывать по отозванному нельзя.
   */
  async update(
    userId: string,
    input: { autoRenew?: boolean; period?: BillingPeriod; plan?: PaidPlan },
    context: AuditContext = {},
  ): Promise<SubscriptionView> {
    const row = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!row || !row.currentPeriodEnd) throw new NotFoundException('Подписки нет');

    if (input.autoRenew === true && !row.paymentMethodEncrypted) {
      throw new ConflictException('Нет сохранённого способа оплаты — оформите подписку заново');
    }
    // Включённое автопродление после конца периода — это льготные дни, то есть
    // платный тариф ещё на трое суток. Включить его на кончившейся подписке
    // значило бы получить их бесплатно и выключить до списания.
    if (input.autoRenew === true && !row.autoRenew && row.currentPeriodEnd <= new Date()) {
      throw new ConflictException('Подписка закончилась — оформите её заново');
    }

    // Тариф и период следующего периода меняются вместе: цена зависит от пары,
    // и пересчитать её по одному полю нельзя. Не переданное остаётся прежним —
    // прежним выбором на следующий период, а не тарифом оплаченного.
    const plan = input.plan ?? toContractPlan(row.nextPlan ?? row.plan);
    const period = input.period ?? toContractPeriod(row.period);
    const renewalChanged =
      toPrismaPlan(plan) !== (row.nextPlan ?? row.plan) || toPrismaPeriod(period) !== row.period;

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: row.id },
        data: {
          // Новый тариф или период — новая сумма списания, и прежнее письмо о
          // списании называло другую. Нужно новое письмо, а с ним и новые три
          // дня. Доступ до конца оплаченного периода остаётся прежним: смена
          // применяется при продлении, доплат и пересчёта остатка нет.
          ...(renewalChanged
            ? {
                // Тариф оплаченного периода (`plan`) не трогается: доступ до
                // его конца остаётся прежним. NULL — выбор совпал с действующим
                // тарифом, то есть смену отменили.
                nextPlan: toPrismaPlan(plan) === row.plan ? null : toPrismaPlan(plan),
                period: toPrismaPeriod(period),
                renewalAmountMinor: PLAN_PRICES[plan][period].amountMinor,
                renewalCurrency: PLAN_PRICES[plan][period].currency,
                renewalNoticeFor: null,
                renewalNoticeSentAt: null,
              }
            : {}),
          ...(input.autoRenew !== undefined
            ? { autoRenew: input.autoRenew, renewalFailures: 0, nextRenewalAttemptAt: null }
            : {}),
        },
      });
      if (input.autoRenew === false) {
        await tx.consent.updateMany({
          where: { userId, document: 'SUBSCRIPTION_OFFER', revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      if (input.autoRenew === true && !row.autoRenew) {
        await tx.consent.create({
          data: {
            userId,
            document: 'SUBSCRIPTION_OFFER',
            documentVersion: LEGAL_DOCUMENTS.SUBSCRIPTION_OFFER.version,
            ipHash: context.ipHash ?? null,
            userAgent: context.userAgent ?? null,
          },
        });
      }
    });

    if (input.autoRenew !== undefined && input.autoRenew !== row.autoRenew) {
      await this.audit.record('billing.autorenew.changed', userId, {
        ...context,
        metadata: { autoRenew: input.autoRenew },
      });
    }
    if (renewalChanged) {
      await this.audit.record('billing.plan.changed', userId, {
        ...context,
        metadata: { plan, period },
      });
    }
    return this.subscription(userId);
  }

  /**
   * Отвязать сохранённый способ оплаты (оферта, 5.6).
   *
   * У ЮKassa отозвать сохранённый способ нельзя: по её документации удаление
   * идентификатора у магазина и есть отвязка. Поэтому стираем шифротекст и
   * подпись, выключаем автопродление и отзываем согласие на списания — списать
   * больше не по чему. Доступ до конца оплаченного периода остаётся, а включить
   * автопродление снова можно только новой оплатой: сохранённого способа нет.
   *
   * Повторный вызов ничего не меняет и в аудит не пишется: отвязывать нечего.
   */
  async removePaymentMethod(userId: string, context: AuditContext = {}): Promise<SubscriptionView> {
    const row = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException('Подписки нет');
    if (!row.paymentMethodEncrypted) return this.subscription(userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: row.id },
        data: {
          paymentMethodEncrypted: null,
          paymentMethodTitle: null,
          autoRenew: false,
          renewalFailures: 0,
          nextRenewalAttemptAt: null,
        },
      });
      await tx.consent.updateMany({
        where: { userId, document: 'SUBSCRIPTION_OFFER', revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.record('billing.payment_method.removed', userId, { ...context });
    return this.subscription(userId);
  }

  /**
   * Бесплатные дни от платформы — например, в компенсацию сбоя.
   *
   * Платежа не создаётся: денег не было. Отметка письма о списании
   * сбрасывается — конец периода сдвинулся, и прежнее письмо называло другую
   * дату. Новое уйдёт по обычному расписанию, и без него списания не будет.
   *
   * Тариф подарка выбирает сотрудник, но у действующей подписки (в том числе в
   * льготные дни) дни продлевают ЕЁ тариф: два тарифа сразу у подписки быть не
   * может, а поднять оплаченный «Мультистрим» до «Про» на весь остаток значило
   * бы подарить больше, чем просили, — и снять такой подарок было бы нечем.
   */
  async extend(
    userId: string,
    days: number,
    plan: PaidPlan,
    context: AuditContext = {},
    now = new Date(),
  ): Promise<SubscriptionView> {
    await this.prisma.$transaction(async (tx) => {
      // Строка подписки блокируется: параллельное применение платежа тоже
      // сдвигает конец периода, и одно из двух продлений потерялось бы.
      const [locked] = await tx.$queryRaw<
        Array<{ id: string; currentPeriodEnd: Date | null }>
      >`SELECT "id", "currentPeriodEnd" FROM "Subscription" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
      const row = locked
        ? await tx.subscription.findUniqueOrThrow({ where: { id: locked.id } })
        : null;
      const current = effectivePlan(row, now);
      if (current !== 'free' && current !== plan) {
        throw new ConflictException(
          'У пользователя действует другой тариф — бесплатные дни продлевают его',
        );
      }

      const from =
        locked?.currentPeriodEnd && locked.currentPeriodEnd > now ? locked.currentPeriodEnd : now;
      const end = new Date(from.getTime() + days * DAY_MS);

      if (row) {
        // Кончившаяся подписка получает тариф подарка. Выбор на следующий
        // период при этом остаётся прежним: сумма продления посчитана под него,
        // и списать цену «Мультистрима» за «Про» (или наоборот) было бы нельзя.
        const renewalPlan = row.nextPlan ?? row.plan;
        const giftedPlan = toPrismaPlan(plan);
        await tx.subscription.update({
          where: { id: row.id },
          data: {
            ...(current === 'free'
              ? { plan: giftedPlan, nextPlan: renewalPlan === giftedPlan ? null : renewalPlan }
              : {}),
            currentPeriodEnd: end,
            // Подаренное копится: два подарка по десять дней снимаются как
            // двадцать, а не как последние десять.
            giftedDays: { increment: days },
            renewalFailures: 0,
            nextRenewalAttemptAt: null,
            renewalNoticeFor: null,
            renewalNoticeSentAt: null,
          },
        });
      } else {
        // Без подписки — месячная без автопродления: списывать нечем и не на
        // что, согласия на списания пользователь не давал.
        await tx.subscription.create({
          data: {
            userId,
            // Месяц без автопродления: списывать нечем и не на что, согласия
            // на списания пользователь не давал.
            plan: toPrismaPlan(plan),
            period: 'MONTH',
            currentPeriodEnd: end,
            autoRenew: false,
            giftedDays: days,
            renewalAmountMinor: PLAN_PRICES[plan].month.amountMinor,
            renewalCurrency: PLAN_PRICES[plan].month.currency,
          },
        });
      }
    });

    await this.audit.record('admin.subscription.extended', userId, {
      ...context,
      metadata: { ...context.metadata, days, plan },
    });
    return this.subscription(userId, now);
  }

  /**
   * Снятие подарочных дней.
   *
   * Снять можно только подаренное: предел запроса — `min(запрошено, подарено)`,
   * и оплаченные дни сотрудник не забирает. Подарок добавил к сроку ровно
   * столько дней, сколько записано в `giftedDays`, поэтому вычитание этого
   * числа убирает именно его.
   *
   * Истёкший срок не восстанавливаем и не двигаем: снимать нечего, а поднять
   * `currentPeriodEnd` до «сейчас» значило бы подарить доступ вместо того,
   * чтобы его забрать.
   *
   * Чего эта арифметика не различает: оплату, оформленную ПОВЕРХ подарка.
   * Платёж продлевает срок от его конца, и снятие подарка сдвигает назад и
   * оплаченную часть. Поэтому подарок снимают до оплаты, а диалог в админке
   * прямо говорит, что срок сдвинется. Разделять оплаченный и подаренный
   * хвосты ради этого случая значит вести в подписке вторую дату — цена выше
   * пользы.
   */
  async revokeGift(
    userId: string,
    days: number,
    context: AuditContext = {},
    now = new Date(),
  ): Promise<SubscriptionView> {
    const revoked = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        Array<{ id: string; currentPeriodEnd: Date | null; giftedDays: number }>
      >`
        SELECT "id", "currentPeriodEnd", "giftedDays" FROM "Subscription"
        WHERE "userId" = ${userId}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Подписки нет');
      if (locked.giftedDays <= 0) {
        throw new ConflictException('Подарочных дней у этой подписки нет');
      }

      const end = locked.currentPeriodEnd;
      if (!end || end <= now) {
        throw new ConflictException('Подарочные дни уже истекли');
      }
      const revoked = Math.min(days, locked.giftedDays);

      await tx.subscription.update({
        where: { id: locked.id },
        data: {
          currentPeriodEnd: new Date(end.getTime() - revoked * DAY_MS),
          giftedDays: { decrement: revoked },
          // Письмо о списании относилось к прежнему концу периода: после
          // сдвига оно уже не про ту дату, и продлить по нему нельзя.
          renewalNoticeFor: null,
          renewalNoticeSentAt: null,
        },
      });
      return revoked;
    });

    // В журнал — сколько снято на самом деле: запрос мог быть больше
    // подаренного, и «снято 30 дней» при снятых 10 вводило бы в заблуждение.
    await this.audit.record('admin.subscription.gift_revoked', userId, {
      ...context,
      metadata: { ...context.metadata, days: revoked, requestedDays: days },
    });
    return this.subscription(userId, now);
  }

  /* ---------------------------------------------------------------- */
  /* Продление — вызывается планировщиком воркера                       */
  /* ---------------------------------------------------------------- */

  /**
   * Письма о предстоящем списании — за три дня до окна продления.
   *
   * Отметка ставится ДО отправки условным обновлением: две реплики воркера не
   * пошлют два письма. Упала отправка — отметка снимается, и письмо уйдёт
   * следующим тактом. Без настроенной почты писем нет, а значит, нет и
   * списаний: `renewDue` берёт только подписки с отправленным письмом.
   *
   * @returns сколько писем отправлено.
   */
  async sendRenewalNotices(now = new Date()): Promise<number> {
    if (!this.configured) return 0;
    if (!this.mailer.configured) {
      this.logger.warn('Почта не настроена: письма о списании не уходят, продления не списываются');
      return 0;
    }

    const staleBefore = new Date(now.getTime() - STALE_NOTICE_MS);
    const candidates = await this.prisma.subscription.findMany({
      where: {
        autoRenew: true,
        paymentMethodEncrypted: { not: null },
        currentPeriodEnd: {
          lte: new Date(now.getTime() + NOTICE_AHEAD_MS),
          // Истёкшие вне льготных дней не продлеваются — и письмо им незачем.
          gt: new Date(now.getTime() - GRACE_DAYS * DAY_MS),
        },
        OR: [{ renewalNoticeFor: null }, { renewalNoticeFor: { lt: staleBefore } }],
      },
      include: {
        user: { select: { email: true, displayName: true, status: true, language: true } },
      },
      orderBy: { currentPeriodEnd: 'asc' },
      take: 50,
    });

    let sent = 0;
    for (const subscription of candidates) {
      const end = subscription.currentPeriodEnd!;
      if (subscription.user.status !== 'ACTIVE') continue;

      const claimed = await this.prisma.subscription.updateMany({
        where: {
          id: subscription.id,
          OR: [{ renewalNoticeFor: null }, { renewalNoticeFor: { lt: staleBefore } }],
        },
        data: { renewalNoticeFor: end, renewalNoticeSentAt: now },
      });
      if (claimed.count === 0) continue;

      const chargeNotBefore = new Date(
        Math.max(end.getTime() - RENEW_AHEAD_MS, now.getTime() + NOTICE_LEAD_MS),
      );
      try {
        await this.mailer.send(
          renewalNoticeMessage({
            email: subscription.user.email,
            displayName: subscription.user.displayName,
            language: mailLanguageSchema.catch('ru').parse(subscription.user.language),
            // Продление пойдёт по выбранному на следующий период тарифу.
            plan: toContractPlan(subscription.nextPlan ?? subscription.plan),
            amount: {
              amountMinor: subscription.renewalAmountMinor,
              currency: subscription.renewalCurrency as 'RUB',
            },
            period: toContractPeriod(subscription.period),
            periodEnd: end,
            chargeNotBefore,
            paymentMethodTitle: subscription.paymentMethodTitle,
            webBaseUrl: this.config.webBaseUrl,
          }),
        );
        sent += 1;
      } catch (error) {
        this.logger.error(
          { err: error, subscriptionId: subscription.id },
          'Письмо о списании не ушло',
        );
        await this.prisma.subscription.updateMany({
          where: { id: subscription.id, renewalNoticeFor: end, renewalNoticeSentAt: now },
          data: { renewalNoticeFor: null, renewalNoticeSentAt: null },
        });
      }
    }
    return sent;
  }

  /**
   * Письмо «оплаченный период заканчивается» — при выключенном автопродлении.
   *
   * Только для оплаченного периода: конец текущего срока должен совпадать с
   * концом успешного невозвращённого платежа. Подарок сотрудника сдвигает
   * конец дальше любого платежа — и подаренные дни кончаются без письма: их
   * человек не покупал. Письмо одно на конец периода (`expiryNoticeFor`),
   * отметка ставится до отправки и снимается при сбое, как у письма о списании.
   *
   * @returns сколько писем отправлено.
   */
  async sendExpiryNotices(now = new Date()): Promise<number> {
    if (!this.configured || !this.mailer.configured) return 0;

    // Проверка «период оплачен» — в запросе, а не после него: иначе полсотни
    // подписок с подаренным хвостом занимали бы всю выборку каждый такт.
    const candidates = await this.prisma.$queryRaw<
      Array<{
        id: string;
        plan: PrismaPlan;
        currentPeriodEnd: Date;
        expiryNoticeFor: Date | null;
        email: string;
        displayName: string;
        language: string;
      }>
    >`
      SELECT s."id", s."plan", s."currentPeriodEnd", s."expiryNoticeFor",
             u."email", u."displayName", u."language"
      FROM "Subscription" s
      JOIN "User" u ON u."id" = s."userId"
      WHERE s."autoRenew" = false
        AND u."status" = 'ACTIVE'
        AND s."currentPeriodEnd" > ${now}
        AND s."currentPeriodEnd" <= ${new Date(now.getTime() + NOTICE_AHEAD_MS)}
        AND (s."expiryNoticeFor" IS NULL OR s."expiryNoticeFor" <> s."currentPeriodEnd")
        AND EXISTS (
          SELECT 1 FROM "Payment" p
          WHERE p."subscriptionId" = s."id"
            AND p."status" = 'SUCCEEDED'
            AND p."refundedAt" IS NULL
            AND p."periodEnd" = s."currentPeriodEnd"
        )
      ORDER BY s."currentPeriodEnd" ASC
      LIMIT 50`;

    let sent = 0;
    for (const subscription of candidates) {
      const end = subscription.currentPeriodEnd;
      const claimed = await this.prisma.subscription.updateMany({
        where: {
          id: subscription.id,
          autoRenew: false,
          currentPeriodEnd: end,
          expiryNoticeFor: subscription.expiryNoticeFor,
        },
        data: { expiryNoticeFor: end },
      });
      if (claimed.count === 0) continue;

      try {
        await this.mailer.send(
          expiryNoticeMessage({
            email: subscription.email,
            displayName: subscription.displayName,
            language: mailLanguageSchema.catch('ru').parse(subscription.language),
            plan: toContractPlan(subscription.plan),
            periodEnd: end,
            webBaseUrl: this.config.webBaseUrl,
          }),
        );
        sent += 1;
      } catch (error) {
        this.logger.error(
          { err: error, subscriptionId: subscription.id },
          'Письмо о конце оплаченного периода не ушло',
        );
        await this.prisma.subscription.updateMany({
          where: { id: subscription.id, expiryNoticeFor: end },
          data: { expiryNoticeFor: subscription.expiryNoticeFor },
        });
      }
    }
    return sent;
  }

  /** Списать продления, срок которых подошёл. @returns сколько подписок обработано. */
  async renewDue(now = new Date()): Promise<number> {
    if (!this.configured) return 0;
    const due = await this.prisma.subscription.findMany({
      where: {
        autoRenew: true,
        // Заблокированному не списываем: пользоваться оплаченным он не может.
        user: { status: 'ACTIVE' },
        paymentMethodEncrypted: { not: null },
        currentPeriodEnd: {
          lte: new Date(now.getTime() + RENEW_AHEAD_MS),
          // После льготных дней подписка кончилась: списывать за неё — брать
          // деньги за доступ, которого у человека уже нет. Так бывает, когда
          // письмо ушло поздно (почта лежала) и три дня с него истекли уже
          // после льготных.
          gt: new Date(now.getTime() - GRACE_DAYS * DAY_MS),
        },
        OR: [{ nextRenewalAttemptAt: null }, { nextRenewalAttemptAt: { lte: now } }],
        // Без письма о текущем конце периода, отправленного не меньше трёх
        // дней назад, не списываем: так обещает оферта. Поздно ушедшее письмо
        // сдвигает списание в льготные дни, а не сокращает срок предупреждения;
        // не уложилось в них — не списываем вовсе.
        renewalNoticeFor: { gte: new Date(now.getTime() - STALE_NOTICE_MS) },
        renewalNoticeSentAt: { lte: new Date(now.getTime() - NOTICE_LEAD_MS) },
      },
      orderBy: { currentPeriodEnd: 'asc' },
      take: 50,
    });

    for (const subscription of due) {
      try {
        await this.renew(subscription);
      } catch (error) {
        // Одна сломанная подписка не должна задерживать остальные.
        this.logger.error({ err: error, subscriptionId: subscription.id }, 'Продление не удалось');
      }
    }
    return due.length;
  }

  /**
   * Дочистить зависшие платежи: уведомление могло не дойти, а продление —
   * оборваться между созданием записи и ответом ЮKassa.
   */
  async reconcilePending(now = new Date()): Promise<void> {
    if (!this.configured) return;
    const stale = await this.prisma.payment.findMany({
      where: { status: 'PENDING', createdAt: { lte: new Date(now.getTime() - 5 * 60 * 1000) } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    for (const row of stale) {
      try {
        if (row.providerPaymentId) {
          await this.syncPayment(row);
        } else if (row.kind === 'RENEWAL' && row.subscriptionId) {
          await this.retryUnconfirmedRenewal(row, now);
        } else if (now.getTime() - row.createdAt.getTime() > 60 * 60 * 1000) {
          // Первый платёж без ответа ЮKassa: страницу оплаты пользователь так и
          // не получил, заплатить по нему нечем.
          await this.prisma.payment.updateMany({
            where: { id: row.id, status: 'PENDING', providerPaymentId: null },
            data: { status: 'CANCELED', cancellationReason: 'gateway_error' },
          });
        }
      } catch (error) {
        this.logger.error({ err: error, paymentId: row.id }, 'Не удалось дочистить платёж');
      }
    }
  }

  private async renew(subscription: Subscription): Promise<void> {
    let row: Payment | null;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        // Та же блокировка, что у оплаты другой картой в льготные дни: между
        // проверкой «незакрытых платежей нет» и созданием списания не должна
        // успеть появиться оплата того же периода.
        await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subscription.id}::uuid FOR UPDATE`;
        // Незакрытое продление уже есть — его доведёт уведомление или дочистка.
        // Незакрытая оплата — стример платит другой картой прямо сейчас: списать
        // старой значило бы взять деньги за период дважды. Не заплатит — ЮKassa
        // отменит платёж, и повтор пойдёт по расписанию.
        const pending = await tx.payment.count({
          where: { subscriptionId: subscription.id, status: 'PENDING' },
        });
        if (pending > 0) return null;
        return tx.payment.create({
          data: {
            userId: subscription.userId,
            subscriptionId: subscription.id,
            kind: 'RENEWAL',
            // Платим за СЛЕДУЮЩИЙ период, значит и за выбранный на него тариф:
            // смена применяется этим списанием. Письмо считало сумму по нему же.
            plan: subscription.nextPlan ?? subscription.plan,
            period: subscription.period,
            // Цена подписки, а не текущий прайс: её и называло письмо о списании.
            amountMinor: subscription.renewalAmountMinor,
            currency: subscription.renewalCurrency,
            renewalFor: subscription.currentPeriodEnd,
            attempt: subscription.renewalFailures + 1,
          },
        });
      });
    } catch (error) {
      // Ту же попытку уже создала другая реплика воркера: блокировка истекла,
      // пока шло списание. Второго списания не будет — его не пустила БД.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
    if (row) await this.chargeRenewal(row);
  }

  /**
   * Списание продления. Повторный вызов для той же записи безопасен: ключ
   * идемпотентности — идентификатор записи, и ЮKassa вернёт прежний платёж.
   */
  private async chargeRenewal(row: Payment): Promise<void> {
    const subscription = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: row.subscriptionId! },
      include: { user: { select: { email: true } } },
    });
    if (!subscription.paymentMethodEncrypted) return;

    let provider: ProviderPayment;
    try {
      provider = await this.gateway.chargeSaved({
        paymentId: row.id,
        amountMinor: row.amountMinor,
        currency: row.currency,
        description: describe(toContractPlan(row.plan), toContractPeriod(row.period)),
        customerEmail: subscription.user.email,
        paymentMethodId: this.crypto.decrypt(subscription.paymentMethodEncrypted),
      });
    } catch (error) {
      // 401, 403 и 429 — отказ НАШЕМУ магазину: ключи, права, частота. Карта
      // стримера тут ни при чём, и считать это неудачной попыткой нельзя: после
      // трёх таких автопродление выключилось бы у каждого, чьё продление
      // пришлось на дни сломанных ключей. Платёж у ЮKassa при отказе не
      // создаётся, поэтому запись удаляется — номер попытки освобождается, — и
      // продление повторится через час.
      if (error instanceof PlatformError && OUR_SIDE_REJECTIONS.has(error.status)) {
        this.logger.error(
          { paymentId: row.id, status: error.status, provider: error.providerError },
          'ЮKassa отказала магазину — продление отложено, проверьте ключи и настройки',
        );
        const removed = await this.prisma.payment.deleteMany({
          where: { id: row.id, status: 'PENDING', providerPaymentId: null },
        });
        if (removed.count > 0) {
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: { nextRenewalAttemptAt: new Date(Date.now() + OUR_SIDE_RETRY_MS) },
          });
          await this.audit.record('billing.renewal.deferred', subscription.userId, {
            metadata: { subscriptionId: subscription.id, status: error.status },
          });
        }
        return;
      }
      // Остальные 4xx — ЮKassa не приняла сам запрос (например, способ оплаты
      // уже недействителен), и повтор с тем же телом получит тот же отказ. Сеть
      // и 5xx оставляют запись висеть: дочистка повторит с тем же ключом.
      if (error instanceof PlatformError && error.status >= 400 && error.status < 500) {
        this.logger.error(
          { paymentId: row.id, status: error.status, provider: error.providerError },
          'ЮKassa отклонила продление',
        );
        const claimed = await this.prisma.payment.updateMany({
          where: { id: row.id, status: 'PENDING' },
          data: { status: 'CANCELED', cancellationReason: 'gateway_rejected' },
        });
        if (claimed.count > 0) await this.recordRenewalFailure(subscription.id, null);
        return;
      }
      throw error;
    }

    await this.prisma.payment.update({
      where: { id: row.id },
      data: { providerPaymentId: provider.id },
    });
    await this.applyProviderPayment({ ...row, providerPaymentId: provider.id }, provider);
  }

  /**
   * Продление, на которое ЮKassa так и не ответила: повторяем с тем же ключом.
   */
  private async retryUnconfirmedRenewal(row: Payment, now: Date): Promise<void> {
    if (now.getTime() - row.createdAt.getTime() > UNCONFIRMED_RENEWAL_TTL_MS) {
      // Ключ идемпотентности вот-вот протухнет, и повтор мог бы списать второй
      // раз. Лучше не продлить и разобраться руками, чем списать дважды.
      this.logger.error({ paymentId: row.id }, 'Продление без ответа ЮKassa — нужна сверка');
      const claimed = await this.prisma.payment.updateMany({
        where: { id: row.id, status: 'PENDING', providerPaymentId: null },
        data: { status: 'CANCELED', cancellationReason: 'unconfirmed' },
      });
      // Считается неудачной попыткой: иначе следующая попытка получила бы тот
      // же номер, упёрлась в уникальность и продление встало бы навсегда.
      if (claimed.count > 0 && row.subscriptionId) {
        await this.recordRenewalFailure(row.subscriptionId, null);
      }
      return;
    }
    await this.chargeRenewal(row);
  }

  private async recordRenewalFailure(subscriptionId: string, reason: string | null): Promise<void> {
    const subscription = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    const failures = subscription.renewalFailures + 1;
    const terminal = reason !== null && TERMINAL_DECLINES.has(reason);
    const giveUp = terminal || failures >= MAX_RENEWAL_ATTEMPTS;

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        renewalFailures: failures,
        nextRenewalAttemptAt: giveUp ? null : new Date(Date.now() + DAY_MS),
        ...(giveUp ? { autoRenew: false } : {}),
        // Способ оплаты с отозванным доступом или истёкшей картой бесполезен и
        // хранить его незачем.
        ...(terminal ? { paymentMethodEncrypted: null, paymentMethodTitle: null } : {}),
      },
    });
    await this.audit.record('billing.renewal.failed', subscription.userId, {
      metadata: { subscriptionId, reason, failures, gaveUp: giveUp },
    });
  }

  /**
   * Перевести платёж в SUCCEEDED и продлить подписку — одной транзакцией.
   *
   * Условный переход `PENDING → SUCCEEDED` отсекает повторы, а строка подписки
   * берётся под `FOR UPDATE`: первый платёж и продление, пришедшие одновременно,
   * иначе оба посчитали бы новый конец от одного и того же старого.
   *
   * @returns false — платёж уже был применён раньше.
   */
  private async markSucceeded(row: Payment, provider: ProviderPayment): Promise<boolean> {
    if (!row.subscriptionId) return false;
    const subscriptionId = row.subscriptionId;

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.payment.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'SUCCEEDED', paidAt: now },
      });
      if (claimed.count === 0) return false;

      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subscriptionId}::uuid FOR UPDATE`;
      const subscription = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });

      // Продление, списанное за сутки до конца, начинается с конца текущего
      // периода: оплаченные дни не теряются. Оплата после окончания — с сегодня:
      // льготные дни в новый период не засчитываются.
      const currentEnd = subscription.currentPeriodEnd;
      const start = currentEnd && currentEnd > now ? currentEnd : now;
      const end = addBillingPeriod(start, toContractPeriod(row.period));

      await tx.payment.update({
        where: { id: row.id },
        data: { periodStart: start, periodEnd: end },
      });

      const method = provider.paymentMethod;
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          currentPeriodEnd: end,
          renewalFailures: 0,
          nextRenewalAttemptAt: null,
          // Оплаченный тариф становится действующим, и выбор на следующий
          // период исполнен. Тариф берётся из платежа, а не из `nextPlan`
          // подписки: списали ровно за то, что в платеже, и доступ обязан
          // совпасть с деньгами, даже если выбор успели сменить после списания.
          plan: row.plan,
          nextPlan: null,
          // Первая оплата задаёт и то, что будет продлеваться: тариф, период и
          // цену. Обычно их записало оформление, но оплата другой картой в
          // льготные дни подписку до денег не трогает — применяется здесь.
          ...(row.kind === 'INITIAL'
            ? {
                period: row.period,
                renewalAmountMinor: row.amountMinor,
                renewalCurrency: row.currency,
              }
            : {}),
          // Способ оплаты запоминается только первым платежом. Продление
          // списано уже сохранённым способом, и ЮKassa возвращает его с
          // `saved: true` — записывать его заново значило бы вернуть карту,
          // которую стример отвязал, пока продление ждало подтверждения
          // (оферта, 5.6), а с ней и возможность снова включить автопродление.
          ...(row.kind === 'INITIAL' && method?.saved
            ? {
                paymentMethodEncrypted: this.crypto.encrypt(method.id),
                paymentMethodTitle: method.title.slice(0, 120),
              }
            : {}),
          // Автопродление включается только первым платежом с сохранённым
          // способом: согласие на него дано при этой оплате. Продление не
          // включает автопродление обратно, если его успели выключить.
          ...(row.kind === 'INITIAL' ? { autoRenew: Boolean(method?.saved) } : {}),
        },
      });
      return true;
    });
  }
}

/** Назначение платежа для ЮKassa: его видит стример в истории банка. */
function describe(plan: PaidPlan, period: BillingPeriod): string {
  const title = plan === 'pro' ? '«Про»' : '«Мультистрим»';
  return period === 'year'
    ? `Подписка StreamKit ${title} на 1 год`
    : `Подписка StreamKit ${title} на 1 месяц`;
}

export function toPaymentView(row: Payment): PaymentView {
  return {
    id: row.id,
    amountMinor: row.amountMinor,
    currency: row.currency as PaymentView['currency'],
    plan: toContractPlan(row.plan),
    period: toContractPeriod(row.period),
    kind: row.kind === 'RENEWAL' ? 'renewal' : 'initial',
    status:
      row.status === 'SUCCEEDED' ? 'succeeded' : row.status === 'CANCELED' ? 'canceled' : 'pending',
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    refundedAmountMinor: row.refundedAmountMinor,
  };
}
