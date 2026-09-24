import { type MailLanguage, PASSWORD_RESET_TTL_MINUTES } from '@streamkit/contracts';
import type { MailMessage } from '../../common/mail/mailer';

export interface PasswordResetMailInput {
  email: string;
  displayName: string;
  /** Ссылка целиком: токен во фрагменте адреса, см. `PasswordResetService`. */
  link: string;
  language: MailLanguage;
}

/**
 * Письмо со ссылкой восстановления пароля. Только текст, как все письма.
 *
 * Письмо говорит, что делать, если пароль не забывали: его получит и тот, чей
 * адрес вписал в форму кто-то другой. Пароль от такого письма не меняется, и
 * человеку нужно знать, что письмо можно просто удалить.
 */
export function passwordResetMessage(input: PasswordResetMailInput): MailMessage {
  const minutes = PASSWORD_RESET_TTL_MINUTES;
  if (input.language === 'en') {
    return {
      to: input.email,
      subject: 'StreamKit: reset your password',
      text: [
        `Hello, ${input.displayName}!`,
        '',
        'Someone asked to reset the password of your StreamKit account. To choose a new password, open this link:',
        input.link,
        '',
        `The link works once and expires in ${minutes} minutes. After the reset every device is signed out; two-factor sign-in, if you use it, stays on.`,
        '',
        'If it was not you, just delete this email: your password stays the same.',
        '— StreamKit',
      ].join('\n'),
    };
  }

  return {
    to: input.email,
    subject: 'StreamKit: восстановление пароля',
    text: [
      `Здравствуйте, ${input.displayName}!`,
      '',
      'Для вашей учётной записи StreamKit запросили восстановление пароля. Чтобы задать новый пароль, откройте ссылку:',
      input.link,
      '',
      `Ссылка действует один раз и ${minutes} минут. После смены пароля все устройства выйдут из аккаунта; двухфакторный вход, если он включён, останется.`,
      '',
      'Если это были не вы, просто удалите письмо: пароль останется прежним.',
      '— StreamKit',
    ].join('\n'),
  };
}
