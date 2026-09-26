import { type MailLanguage, PASSWORD_RESET_TTL_MINUTES } from '@streamkit/contracts';
import { renderMail } from '../../common/mail/mail-layout';
import type { MailMessage } from '../../common/mail/mailer';
import { SECURITY_FOOTNOTE } from './security-mail';

export interface PasswordResetMailInput {
  email: string;
  displayName: string;
  /** Ссылка целиком: токен во фрагменте адреса, см. `PasswordResetService`. */
  link: string;
  language: MailLanguage;
}

/**
 * Письмо со ссылкой восстановления пароля.
 *
 * Письмо говорит, что делать, если пароль не забывали: его получит и тот, чей
 * адрес вписал в форму кто-то другой. Пароль от такого письма не меняется, и
 * человеку нужно знать, что письмо можно просто удалить.
 */
export function passwordResetMessage(input: PasswordResetMailInput): MailMessage {
  const minutes = PASSWORD_RESET_TTL_MINUTES;
  const language = input.language;
  const content =
    language === 'en'
      ? {
          subject: 'StreamKit: reset your password',
          preheader: `The link works once and expires in ${minutes} minutes.`,
          heading: 'Password reset',
          greeting: `Hello, ${input.displayName}!`,
          blocks: [
            {
              kind: 'paragraph' as const,
              text: 'Someone asked to reset the password of your StreamKit account. To choose a new password, open the link below.',
            },
            { kind: 'action' as const, label: 'Choose a new password', url: input.link },
            {
              kind: 'paragraph' as const,
              text: `The link works once and expires in ${minutes} minutes. After the reset every device is signed out; two-factor sign-in, if you use it, stays on.`,
            },
            {
              kind: 'notice' as const,
              text: 'If it was not you, just delete this email: your password stays the same.',
            },
          ],
        }
      : {
          subject: 'StreamKit: восстановление пароля',
          preheader: `Ссылка действует один раз и ${minutes} минут.`,
          heading: 'Восстановление пароля',
          greeting: `Здравствуйте, ${input.displayName}!`,
          blocks: [
            {
              kind: 'paragraph' as const,
              text: 'Для вашей учётной записи StreamKit запросили восстановление пароля. Чтобы задать новый пароль, откройте ссылку ниже.',
            },
            { kind: 'action' as const, label: 'Задать новый пароль', url: input.link },
            {
              kind: 'paragraph' as const,
              text: `Ссылка действует один раз и ${minutes} минут. После смены пароля все устройства выйдут из аккаунта; двухфакторный вход, если он включён, останется.`,
            },
            {
              kind: 'notice' as const,
              text: 'Если это были не вы, просто удалите письмо: пароль останется прежним.',
            },
          ],
        };

  return {
    to: input.email,
    ...renderMail({ ...content, language, footnote: SECURITY_FOOTNOTE[language] }),
  };
}
