import { type BillingPeriod, formatMoney, type Money } from '@streamkit/contracts';
import type { MailMessage } from '../../common/mail/mailer';

export interface RenewalNoticeInput {
  email: string;
  displayName: string;
  amount: Money;
  period: BillingPeriod;
  /** Конец оплаченного периода. */
  periodEnd: Date;
  /** Раньше этого момента списания не будет: три дня от письма, не раньше суток до конца. */
  chargeNotBefore: Date;
  paymentMethodTitle: string | null;
  webBaseUrl: string;
}

/**
 * Даты в письме — по Москве: аудитория в России, а «15 октября» по UTC для
 * списания в 02:00 ночи по Москве было бы уже вчерашним числом.
 */
const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Moscow',
});

/** Письмо о предстоящем автоматическом списании (п. 5 оферты). Только текст. */
export function renewalNoticeMessage(input: RenewalNoticeInput): MailMessage {
  const base = input.webBaseUrl.replace(/\/+$/, '');
  const method = input.paymentMethodTitle ? ` (${input.paymentMethodTitle})` : '';
  const periodLabel = input.period === 'year' ? '1 год' : '1 месяц';

  return {
    to: input.email,
    subject: `StreamKit: ${DATE.format(input.chargeNotBefore)} спишем ${formatMoney(input.amount)} за тариф «Про»`,
    text: [
      `Здравствуйте, ${input.displayName}!`,
      '',
      `Оплаченный период тарифа «Про» заканчивается ${DATE.format(input.periodEnd)}.`,
      `Не ранее ${DATE.format(input.chargeNotBefore)} с сохранённого способа оплаты${method} ` +
        `будет списано ${formatMoney(input.amount)} за продление на ${periodLabel}.`,
      '',
      'Если продлевать не нужно, выключите автопродление в профиле, раздел «Тариф», — одной кнопкой:',
      `${base}/account/billing`,
      'После отключения ничего не спишется, а доступ сохранится до конца оплаченного периода.',
      '',
      `Условия тарифа: ${base}/legal/subscription`,
      '',
      'Это служебное письмо об автоматическом списании. Оно приходит перед каждым продлением.',
      '— StreamKit',
    ].join('\n'),
  };
}
