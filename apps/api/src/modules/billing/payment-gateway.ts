/**
 * Платёжный шлюз — ровно то, чем пользуется платформа.
 *
 * Интерфейс, а не прямой вызов ЮKassa, ради тестов: интеграционные тесты
 * проверяют нашу логику (когда продлить, сколько раз, что делать с отказом) и
 * подменяют шлюз, а сквозной прогон ходит в фальшивый сервер по HTTP.
 */
export interface PaymentGateway {
  /** Первый платёж: страница оплаты и сохранение способа оплаты для продлений. */
  createPayment(request: CreatePaymentRequest): Promise<ProviderPayment>;
  /** Продление: списание по сохранённому способу, без участия стримера. */
  chargeSaved(request: ChargeSavedRequest): Promise<ProviderPayment>;
  /** Статус платежа — единственный источник правды о том, прошли ли деньги. */
  getPayment(providerPaymentId: string): Promise<ProviderPayment>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

interface PaymentRequestBase {
  /**
   * Наш идентификатор платежа. Он же ключ идемпотентности: повтор запроса с тем
   * же ключом не создаёт второй платёж — ни при ретрае на 5xx, ни при повторе
   * продления следующим тактом воркера.
   */
  paymentId: string;
  amountMinor: number;
  currency: string;
  description: string;
  /** Для чека 54-ФЗ: ЮKassa отправит его сюда. */
  customerEmail: string;
}

export interface CreatePaymentRequest extends PaymentRequestBase {
  returnUrl: string;
}

export interface ChargeSavedRequest extends PaymentRequestBase {
  paymentMethodId: string;
}

export type ProviderPaymentStatus = 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';

export interface ProviderPayment {
  id: string;
  status: ProviderPaymentStatus;
  amountMinor: number;
  currency: string;
  /** Наш идентификатор из metadata — сверяется с платежом, к которому привязан. */
  paymentId: string | null;
  paymentMethod: { id: string; saved: boolean; title: string } | null;
  cancellationReason: string | null;
  confirmationUrl: string | null;
}
