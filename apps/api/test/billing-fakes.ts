import { PlatformAuthError, PlatformError } from '../src/common/http/platform-errors';
import type { MailMessage, Mailer } from '../src/common/mail/mailer';
import type {
  ChargeSavedRequest,
  CreatePaymentRequest,
  PaymentGateway,
  ProviderPayment,
} from '../src/modules/billing/payment-gateway';

/**
 * ЮKassa в памяти. Ведёт себя как настоящая в том, что важно для денег: платёж
 * с тем же ключом идемпотентности — тот же платёж, а не новый.
 */
export class FakeGateway implements PaymentGateway {
  readonly payments = new Map<string, ProviderPayment>();
  readonly created: CreatePaymentRequest[] = [];
  readonly charged: ChargeSavedRequest[] = [];
  gets = 0;
  failGet = false;
  failCreate = false;
  /** Отказ ЮKassa (4xx), а не сбой связи: так отвечает боевой магазин без автоплатежей. */
  rejectCreate = false;
  /** Код отказа ЮKassa на списание по сохранённому способу (4xx), если задан. */
  rejectCharge: number | null = null;
  /** Чем ответит следующее списание по сохранённому способу. */
  chargeOutcome: { status: 'succeeded' } | { status: 'canceled'; reason: string } = {
    status: 'succeeded',
  };
  private sequence = 0;

  private byIdempotenceKey(paymentId: string): ProviderPayment | undefined {
    return [...this.payments.values()].find((payment) => payment.paymentId === paymentId);
  }

  async createPayment(request: CreatePaymentRequest): Promise<ProviderPayment> {
    if (this.failCreate) throw new Error('ЮKassa недоступна');
    if (this.rejectCreate) throw new PlatformAuthError('yookassa', 403, 'Площадка отвергла токен');
    this.created.push(request);
    const existing = this.byIdempotenceKey(request.paymentId);
    if (existing) return { ...existing };
    const id = `yk-${++this.sequence}`;
    const payment: ProviderPayment = {
      id,
      status: 'pending',
      amountMinor: request.amountMinor,
      currency: request.currency,
      paymentId: request.paymentId,
      paymentMethod: null,
      cancellationReason: null,
      confirmationUrl: `https://yookassa.test/confirm/${id}`,
    };
    this.payments.set(id, payment);
    return { ...payment };
  }

  async chargeSaved(request: ChargeSavedRequest): Promise<ProviderPayment> {
    this.charged.push(request);
    if (this.rejectCharge !== null) {
      throw new PlatformError(
        'yookassa',
        this.rejectCharge,
        `ЮKassa ответила ${this.rejectCharge}`,
      );
    }
    const existing = this.byIdempotenceKey(request.paymentId);
    if (existing) return { ...existing };
    const id = `yk-${++this.sequence}`;
    const outcome = this.chargeOutcome;
    const payment: ProviderPayment = {
      id,
      status: outcome.status,
      amountMinor: request.amountMinor,
      currency: request.currency,
      paymentId: request.paymentId,
      paymentMethod: { id: request.paymentMethodId, saved: true, title: 'Карта *4444' },
      cancellationReason: outcome.status === 'canceled' ? outcome.reason : null,
      confirmationUrl: null,
    };
    this.payments.set(id, payment);
    return { ...payment };
  }

  /** Возвраты в копейках по идентификатору платежа ЮKassa. */
  readonly refunds = new Map<string, number>();
  refundQueries = 0;

  async refundedAmount(providerPaymentId: string) {
    this.refundQueries += 1;
    return { amountMinor: this.refunds.get(providerPaymentId) ?? 0, currency: 'RUB' };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    this.gets += 1;
    if (this.failGet) throw new Error('ЮKassa недоступна');
    const payment = this.payments.get(providerPaymentId);
    if (!payment) throw new Error('нет такого платежа');
    return { ...payment };
  }

  /** Стример оплатил на странице ЮKassa. */
  pay(providerPaymentId: string, overrides: Partial<ProviderPayment> = {}): void {
    const payment = this.payments.get(providerPaymentId)!;
    Object.assign(payment, {
      status: 'succeeded',
      paymentMethod: { id: 'pm-secret-4444', saved: true, title: 'Карта *4444' },
      ...overrides,
    });
  }

  cancel(providerPaymentId: string, reason: string): void {
    Object.assign(this.payments.get(providerPaymentId)!, {
      status: 'canceled',
      cancellationReason: reason,
    });
  }

  reset(): void {
    this.payments.clear();
    this.refunds.clear();
    this.refundQueries = 0;
    this.created.length = 0;
    this.charged.length = 0;
    this.gets = 0;
    this.failGet = false;
    this.failCreate = false;
    this.rejectCreate = false;
    this.rejectCharge = null;
    this.chargeOutcome = { status: 'succeeded' };
  }
}

/** Почта в памяти: что и кому ушло. */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  configured = true;
  fail = false;

  async send(message: MailMessage): Promise<void> {
    if (this.fail) throw new Error('SMTP недоступен');
    this.sent.push(message);
  }

  reset(): void {
    this.sent.length = 0;
    this.configured = true;
    this.fail = false;
  }
}
