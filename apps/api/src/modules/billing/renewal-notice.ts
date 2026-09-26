import {
  type BillingPeriod,
  formatMoney,
  type MailLanguage,
  type Money,
  type PaidPlan,
} from '@streamkit/contracts';
import { type MailBlock, renderMail } from '../../common/mail/mail-layout';
import type { MailMessage } from '../../common/mail/mailer';
import { formatMailDate, mailUrl } from '../../common/mail/mail-text';

const PLAN_TITLE: Record<MailLanguage, Record<PaidPlan, string>> = {
  ru: { multistream: 'Мультистрим', pro: 'Про' },
  en: { multistream: 'Multistream', pro: 'Pro' },
};

const PERIOD_TITLE: Record<MailLanguage, Record<BillingPeriod, string>> = {
  ru: { month: '1 месяц', year: '1 год' },
  en: { month: '1 month', year: '1 year' },
};

const MONEY_LOCALE: Record<MailLanguage, string> = { ru: 'ru-RU', en: 'en-GB' };

interface BillingMailInput {
  email: string;
  displayName: string;
  language: MailLanguage;
  /** Тариф, по которому продлится (или по которому оплачен) период. */
  plan: PaidPlan;
  /** Конец оплаченного периода. */
  periodEnd: Date;
  webBaseUrl: string;
}

export interface RenewalNoticeInput extends BillingMailInput {
  amount: Money;
  period: BillingPeriod;
  /** Раньше этого момента списания не будет: три дня от письма, не раньше суток до конца. */
  chargeNotBefore: Date;
  paymentMethodTitle: string | null;
}

export type ExpiryNoticeInput = BillingMailInput;

function greeting(input: BillingMailInput): string {
  return input.language === 'en'
    ? `Hello, ${input.displayName}!`
    : `Здравствуйте, ${input.displayName}!`;
}

/**
 * Письмо о предстоящем автоматическом списании (п. 5 оферты).
 *
 * Без него продление не списывается (`BillingService.renewDue`), поэтому
 * письмо говорит всё, что нужно, чтобы отказаться: сумму, дату, способ оплаты
 * и где выключить — одной кнопкой.
 */
export function renewalNoticeMessage(input: RenewalNoticeInput): MailMessage {
  const { language } = input;
  const plan = PLAN_TITLE[language][input.plan];
  const amount = formatMoney(input.amount, MONEY_LOCALE[language]);
  const billingUrl = mailUrl(input.webBaseUrl, '/account/billing', language);
  const offerUrl = mailUrl(input.webBaseUrl, '/legal/subscription', language);
  const chargeDate = formatMailDate(input.chargeNotBefore, language);
  const endDate = formatMailDate(input.periodEnd, language);

  if (language === 'en') {
    const rows = [
      { label: 'Amount', value: amount },
      { label: 'Not earlier than', value: chargeDate },
      { label: 'Renews for', value: PERIOD_TITLE.en[input.period] },
      ...(input.paymentMethodTitle
        ? [{ label: 'Payment method', value: input.paymentMethodTitle }]
        : []),
    ];
    const blocks: MailBlock[] = [
      {
        kind: 'paragraph',
        text: `The paid period of the “${plan}” plan ends on ${endDate}. Auto-renewal is on, so the next period will be charged to your saved payment method.`,
      },
      { kind: 'details', rows },
      {
        kind: 'paragraph',
        text: 'If you do not want to renew, turn off auto-renewal in your profile, under Plan. Nothing will be charged, and access stays until the end of the paid period.',
      },
      { kind: 'action', label: 'Open Plan settings', url: billingUrl },
      { kind: 'links', items: [{ label: 'Paid plans offer', url: offerUrl }] },
    ];
    return {
      to: input.email,
      ...renderMail({
        language,
        subject: `StreamKit: ${amount} for the “${plan}” plan will be charged on ${chargeDate}`,
        preheader: `Turn off auto-renewal before ${chargeDate} if you do not want to renew.`,
        heading: 'Renewal coming up',
        greeting: greeting(input),
        blocks,
        footnote:
          'This is a service email about an automatic charge. It is sent before every renewal: without it, nothing is charged.',
      }),
    };
  }

  const rows = [
    { label: 'Сумма', value: amount },
    { label: 'Не ранее', value: chargeDate },
    { label: 'Продление на', value: PERIOD_TITLE.ru[input.period] },
    ...(input.paymentMethodTitle
      ? [{ label: 'Способ оплаты', value: input.paymentMethodTitle }]
      : []),
  ];
  const blocks: MailBlock[] = [
    {
      kind: 'paragraph',
      text: `Оплаченный период тарифа «${plan}» заканчивается ${endDate}. Автопродление включено: следующий период спишется с сохранённого способа оплаты.`,
    },
    { kind: 'details', rows },
    {
      kind: 'paragraph',
      text: 'Если продлевать не нужно, выключите автопродление в профиле, раздел «Тариф». Ничего не спишется, а доступ сохранится до конца оплаченного периода.',
    },
    { kind: 'action', label: 'Открыть раздел «Тариф»', url: billingUrl },
    { kind: 'links', items: [{ label: 'Оферта платных тарифов', url: offerUrl }] },
  ];
  return {
    to: input.email,
    ...renderMail({
      language,
      subject: `StreamKit: ${chargeDate} спишем ${amount} за тариф «${plan}»`,
      preheader: `Выключите автопродление до ${chargeDate}, если продлевать не нужно.`,
      heading: 'Скоро продление',
      greeting: greeting(input),
      blocks,
      footnote:
        'Это служебное письмо об автоматическом списании. Оно приходит перед каждым продлением: без него списания не будет.',
    }),
  };
}

/**
 * Оплаченный период кончается, а автопродление выключено.
 *
 * Только для периода, за который заплатили: подаренные дни кончаются без
 * письма, их конец человек не покупал и продлевать не собирался. Письмо не
 * предупреждает о списании — его не будет, — а говорит, что изменится и как
 * продлить, если нужно.
 */
export function expiryNoticeMessage(input: ExpiryNoticeInput): MailMessage {
  const { language } = input;
  const plan = PLAN_TITLE[language][input.plan];
  const billingUrl = mailUrl(input.webBaseUrl, '/account/billing', language);
  const endDate = formatMailDate(input.periodEnd, language);

  if (language === 'en') {
    return {
      to: input.email,
      ...renderMail({
        language,
        subject: `StreamKit: the “${plan}” plan is paid until ${endDate}`,
        preheader: 'Auto-renewal is off: renew the plan to keep its features.',
        heading: 'Paid period ends soon',
        greeting: greeting(input),
        blocks: [
          {
            kind: 'paragraph',
            text: `The paid period of the “${plan}” plan ends on ${endDate}. Auto-renewal is off, so nothing will be charged.`,
          },
          {
            kind: 'paragraph',
            text: 'After that date the account moves to the free plan. Widgets and settings stay: the widget limit applies only to new widgets, and one platform stays active — you choose which.',
          },
          {
            kind: 'paragraph',
            text: 'To keep the plan, turn auto-renewal back on or pay for the next period in your profile, under Plan.',
          },
          { kind: 'action', label: 'Renew the plan', url: billingUrl },
        ],
        footnote:
          'This is a service email about your paid plan. It is sent once, a few days before a paid period ends without renewal.',
      }),
    };
  }

  return {
    to: input.email,
    ...renderMail({
      language,
      subject: `StreamKit: тариф «${plan}» оплачен до ${endDate}`,
      preheader: 'Автопродление выключено: продлите тариф, чтобы сохранить его возможности.',
      heading: 'Оплаченный период заканчивается',
      greeting: greeting(input),
      blocks: [
        {
          kind: 'paragraph',
          text: `Оплаченный период тарифа «${plan}» заканчивается ${endDate}. Автопродление выключено, поэтому ничего не спишется.`,
        },
        {
          kind: 'paragraph',
          text: 'После этой даты аккаунт перейдёт на бесплатный тариф. Виджеты и настройки сохранятся: лимит виджетов действует только на новые, а из площадок останется активной одна — какая, выберете вы.',
        },
        {
          kind: 'paragraph',
          text: 'Чтобы тариф продолжился, включите автопродление или оплатите следующий период в профиле, раздел «Тариф».',
        },
        { kind: 'action', label: 'Продлить тариф', url: billingUrl },
      ],
      footnote:
        'Это служебное письмо об оплаченном тарифе. Оно приходит один раз, за несколько дней до конца оплаченного периода без продления.',
    }),
  };
}
