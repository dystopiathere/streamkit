import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '../../config/app-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  /** Текстовая версия — есть у каждого письма, см. `renderMail`. */
  text: string;
  /**
   * Свёрстанная версия из `renderMail`. В неё попадают имя стримера и название
   * способа оплаты — вёрстка экранирует их сама, собирать HTML в обход неё
   * нельзя.
   */
  html: string;
}

/**
 * Отправка служебных писем.
 *
 * Интерфейс под символом `MAILER`, как `PAYMENT_GATEWAY`: интеграционные тесты
 * подменяют его провайдером и проверяют, что и кому ушло.
 */
export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/** Секунд на соединение и ответ SMTP: такт воркера не должен висеть на почте. */
const SMTP_TIMEOUT_MS = 15_000;

@Injectable()
export class SmtpMailer implements Mailer {
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return this.config.mail !== null;
  }

  async send(message: MailMessage): Promise<void> {
    const mail = this.config.mail;
    if (!mail) throw new ServiceUnavailableException('Почта не настроена');

    this.transporter ??= createTransport({
      host: mail.host,
      port: mail.port,
      // 465 — TLS сразу, остальные порты — STARTTLS. В проде без шифрования
      // не отправляем вовсе: в письме адрес и сумма списания.
      secure: mail.port === 465,
      requireTLS: this.config.isProduction && mail.port !== 465,
      auth: mail.user ? { user: mail.user, pass: mail.password ?? '' } : undefined,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });

    await this.transporter.sendMail({
      from: mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
