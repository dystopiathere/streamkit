import { EMAIL_VERIFICATION_TTL_HOURS, type MailLanguage } from '@streamkit/contracts';
import { type MailBlock, renderMail } from '../../common/mail/mail-layout';
import type { MailMessage } from '../../common/mail/mailer';

export interface EmailVerificationMailInput {
  email: string;
  displayName: string;
  /** Ссылка целиком: токен во фрагменте адреса, см. `EmailVerificationService`. */
  link: string;
  language: MailLanguage;
}

/**
 * Письмо со ссылкой подтверждения почты.
 *
 * Его получит и тот, чей адрес вписал при регистрации кто-то другой, поэтому
 * письмо говорит, что будет, если ничего не делать: ничего, уведомлений на
 * этот адрес не будет.
 */
export function emailVerificationMessage(input: EmailVerificationMailInput): MailMessage {
  const hours = EMAIL_VERIFICATION_TTL_HOURS;
  const { language } = input;

  const content: {
    subject: string;
    preheader: string;
    heading: string;
    greeting: string;
    blocks: MailBlock[];
    footnote: string;
  } =
    language === 'en'
      ? {
          subject: 'StreamKit: confirm your email',
          preheader: `The link works for ${hours} hours.`,
          heading: 'Confirm your email',
          greeting: `Hello, ${input.displayName}!`,
          blocks: [
            {
              kind: 'paragraph',
              text: 'This address was used to create a StreamKit account. Confirm that it is yours: after that we will send security notices, payment reminders and document updates here, and paid plans become available.',
            },
            { kind: 'action', label: 'Confirm email', url: input.link },
            {
              kind: 'paragraph',
              text: `The link works for ${hours} hours. If it has expired, request a new one from the dashboard.`,
            },
          ],
          footnote:
            'If you did not create a StreamKit account, just delete this email: without confirmation this address receives no notices from us.',
        }
      : {
          subject: 'StreamKit: подтвердите почту',
          preheader: `Ссылка действует ${hours} часа.`,
          heading: 'Подтвердите почту',
          greeting: `Здравствуйте, ${input.displayName}!`,
          blocks: [
            {
              kind: 'paragraph',
              text: 'На этот адрес зарегистрирована учётная запись StreamKit. Подтвердите, что он ваш: после этого сюда будут приходить письма о безопасности, списаниях и изменениях документов, а в дашборде откроется оплата тарифа.',
            },
            { kind: 'action', label: 'Подтвердить почту', url: input.link },
            {
              kind: 'paragraph',
              text: `Ссылка действует ${hours} часа. Если срок вышел, запросите новую в дашборде.`,
            },
          ],
          footnote:
            'Если вы не регистрировались в StreamKit, просто удалите письмо: без подтверждения уведомления на этот адрес не приходят.',
        };

  return { to: input.email, ...renderMail({ ...content, language }) };
}
