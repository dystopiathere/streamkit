import { describeUserAgent, type MailLanguage } from '@streamkit/contracts';
import { type MailBlock, renderMail } from '../../common/mail/mail-layout';
import type { MailMessage } from '../../common/mail/mailer';
import { formatMailDateTime, mailUrl, UNKNOWN_DEVICE } from '../../common/mail/mail-text';

/** Почему пришло письмо — одинаково у всех писем о безопасности. */
export const SECURITY_FOOTNOTE: Record<MailLanguage, string> = {
  ru: 'Это служебное письмо о безопасности вашей учётной записи StreamKit. Такие письма приходят всегда: без них о чужом входе в аккаунт было бы неоткуда узнать.',
  en: 'This is a security notice about your StreamKit account. Security notices are always sent: without them you would have no way to learn about someone else signing in.',
};

export interface SecurityMailInput {
  email: string;
  displayName: string;
  language: MailLanguage;
  /** Когда это произошло. */
  at: Date;
  /** User-Agent запроса, из которого это сделали. */
  userAgent: string | null;
  webBaseUrl: string;
}

export interface PasswordChangedMailInput extends SecurityMailInput {
  /** `settings` — сменили в профиле, `reset` — задали по ссылке из письма. */
  via: 'settings' | 'reset';
}

const COPY = {
  ru: {
    when: 'Когда',
    device: 'Устройство',
    itWasYou: 'Если это были вы, ничего делать не нужно.',
    openSecurity: 'Открыть раздел «Безопасность»',
  },
  en: {
    when: 'When',
    device: 'Device',
    itWasYou: 'If it was you, there is nothing to do.',
    openSecurity: 'Open Security settings',
  },
} as const;

function eventDetails(input: SecurityMailInput): MailBlock {
  const copy = COPY[input.language];
  return {
    kind: 'details',
    rows: [
      { label: copy.when, value: formatMailDateTime(input.at, input.language) },
      {
        label: copy.device,
        value: describeUserAgent(input.userAgent) ?? UNKNOWN_DEVICE[input.language],
      },
    ],
  };
}

function message(
  input: SecurityMailInput,
  content: { subject: string; preheader: string; heading: string; blocks: MailBlock[] },
): MailMessage {
  const greeting =
    input.language === 'en'
      ? `Hello, ${input.displayName}!`
      : `Здравствуйте, ${input.displayName}!`;
  return {
    to: input.email,
    ...renderMail({
      ...content,
      language: input.language,
      greeting,
      footnote: SECURITY_FOOTNOTE[input.language],
    }),
  };
}

/**
 * Пароль изменён — в профиле или по ссылке восстановления.
 *
 * Если пароль сменил не владелец, его устройства уже вышли из аккаунта, а
 * старый пароль больше не подходит. Единственный путь назад — восстановление
 * по почте, которая всё ещё его, поэтому кнопка ведёт туда, а не в профиль.
 */
export function passwordChangedMessage(input: PasswordChangedMailInput): MailMessage {
  const { language } = input;
  const copy = COPY[language];
  const resetUrl = mailUrl(input.webBaseUrl, '/forgot-password', language);

  if (language === 'en') {
    return message(input, {
      subject: 'StreamKit: your password was changed',
      preheader:
        input.via === 'reset'
          ? 'Every device has been signed out.'
          : 'Every other device has been signed out.',
      heading: 'Password changed',
      blocks: [
        {
          kind: 'paragraph',
          text:
            input.via === 'reset'
              ? 'The password of your StreamKit account was reset with a link from email. Every device has been signed out.'
              : 'The password of your StreamKit account was changed in Security settings. Every other device has been signed out.',
        },
        eventDetails(input),
        { kind: 'paragraph', text: copy.itWasYou },
        {
          kind: 'notice',
          text: 'If it was not you, reset the password now: a new password signs everyone out, including whoever changed it.',
        },
        { kind: 'action', label: 'Reset password', url: resetUrl },
      ],
    });
  }

  return message(input, {
    subject: 'StreamKit: пароль изменён',
    preheader:
      input.via === 'reset'
        ? 'Все устройства вышли из аккаунта.'
        : 'Остальные устройства вышли из аккаунта.',
    heading: 'Пароль изменён',
    blocks: [
      {
        kind: 'paragraph',
        text:
          input.via === 'reset'
            ? 'Пароль от вашей учётной записи StreamKit задан заново по ссылке из письма. Все устройства вышли из аккаунта.'
            : 'Пароль от вашей учётной записи StreamKit изменён в разделе «Безопасность». Остальные устройства вышли из аккаунта.',
      },
      eventDetails(input),
      { kind: 'paragraph', text: copy.itWasYou },
      {
        kind: 'notice',
        text: 'Если пароль меняли не вы, восстановите его сейчас: новый пароль выведет из аккаунта всех, включая того, кто его сменил.',
      },
      { kind: 'action', label: 'Восстановить пароль', url: resetUrl },
    ],
  });
}

/** Вход из браузера, из которого в аккаунт ещё не входили. */
export function newDeviceMessage(input: SecurityMailInput): MailMessage {
  const { language } = input;
  const copy = COPY[language];
  const securityUrl = mailUrl(input.webBaseUrl, '/account/security', language);
  const device = describeUserAgent(input.userAgent) ?? UNKNOWN_DEVICE[language];

  if (language === 'en') {
    return message(input, {
      subject: 'StreamKit: new sign-in to your account',
      preheader: `${device} signed in to your account.`,
      heading: 'New sign-in',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Someone signed in to your StreamKit account from a browser that has not been used with it before.',
        },
        eventDetails(input),
        { kind: 'paragraph', text: copy.itWasYou },
        {
          kind: 'notice',
          text: 'If it was not you, change your password in Security settings: every other device will be signed out. You can also turn on two-factor sign-in there.',
        },
        { kind: 'action', label: copy.openSecurity, url: securityUrl },
      ],
    });
  }

  return message(input, {
    subject: 'StreamKit: вход с нового устройства',
    preheader: `${device}: вход в вашу учётную запись.`,
    heading: 'Вход с нового устройства',
    blocks: [
      {
        kind: 'paragraph',
        text: 'В вашу учётную запись StreamKit вошли из браузера, из которого в неё раньше не входили.',
      },
      eventDetails(input),
      { kind: 'paragraph', text: copy.itWasYou },
      {
        kind: 'notice',
        text: 'Если это были не вы, смените пароль в разделе «Безопасность»: остальные устройства выйдут из аккаунта. Там же включается двухфакторный вход.',
      },
      { kind: 'action', label: copy.openSecurity, url: securityUrl },
    ],
  });
}

/** Двухфакторный вход выключен: для входа снова достаточно пароля. */
export function totpDisabledMessage(input: SecurityMailInput): MailMessage {
  const { language } = input;
  const copy = COPY[language];
  const securityUrl = mailUrl(input.webBaseUrl, '/account/security', language);

  if (language === 'en') {
    return message(input, {
      subject: 'StreamKit: two-factor sign-in turned off',
      preheader: 'Your password alone now signs in to your account.',
      heading: 'Two-factor sign-in off',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Two-factor sign-in has been turned off for your StreamKit account. Your password alone now signs in to it.',
        },
        eventDetails(input),
        { kind: 'paragraph', text: copy.itWasYou },
        {
          kind: 'notice',
          text: 'If it was not you, change your password and turn two-factor sign-in back on in Security settings.',
        },
        { kind: 'action', label: copy.openSecurity, url: securityUrl },
      ],
    });
  }

  return message(input, {
    subject: 'StreamKit: двухфакторный вход выключен',
    preheader: 'Теперь для входа в аккаунт достаточно пароля.',
    heading: 'Двухфакторный вход выключен',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Для вашей учётной записи StreamKit выключен двухфакторный вход: теперь для входа достаточно пароля.',
      },
      eventDetails(input),
      { kind: 'paragraph', text: copy.itWasYou },
      {
        kind: 'notice',
        text: 'Если это были не вы, смените пароль и снова включите двухфакторный вход в разделе «Безопасность».',
      },
      { kind: 'action', label: copy.openSecurity, url: securityUrl },
    ],
  });
}
