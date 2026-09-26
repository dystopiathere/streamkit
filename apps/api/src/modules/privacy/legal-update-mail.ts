import type { ConsentDocument } from '@prisma/client';
import type { MailLanguage } from '@streamkit/contracts';
import { type MailBlock, renderMail } from '../../common/mail/mail-layout';
import type { MailMessage } from '../../common/mail/mailer';
import { formatMailDate, mailUrl } from '../../common/mail/mail-text';
import type { LegalDocument } from './legal-documents';

/** Названия документов для английского письма: в реестре они только русские. */
const TITLE_EN: Record<ConsentDocument, string> = {
  TERMS: 'Terms of Service',
  PRIVACY: 'Privacy Policy',
  PERSONAL_DATA: 'Consent to personal data processing',
  COOKIE_ANALYTICS: 'Visit statistics (cookies)',
  MARKETING: 'Marketing emails',
  SUBSCRIPTION_OFFER: 'Paid plans offer and automatic charges',
};

export interface LegalUpdateMailInput {
  email: string;
  displayName: string;
  language: MailLanguage;
  documents: readonly LegalDocument[];
  webBaseUrl: string;
}

/**
 * Дата редакции из версии: `2026-09-25.2` — вторая редакция 25 сентября.
 * Полдень UTC — чтобы дата по Москве не съехала на соседние сутки.
 */
function editionDate(version: string): Date {
  return new Date(`${version.slice(0, 10)}T12:00:00Z`);
}

/**
 * Письмо о новых редакциях документов — одно на все изменившиеся сразу.
 *
 * Что делать, зависит от документа (`LegalDocument.updatePolicy`): договор и
 * политику заново не принимают, а согласия по 152-ФЗ подтверждают — молчание
 * согласием не является. Письмо говорит это прямо, чтобы «подтвердите» не
 * читалось как «иначе отключим»: доступ ни от того, ни от другого не зависит.
 */
export function legalUpdateMessage(input: LegalUpdateMailInput): MailMessage {
  const { language } = input;
  const privacyUrl = mailUrl(input.webBaseUrl, '/account/privacy', language);
  const needsConsent = input.documents.some((document) => document.updatePolicy === 'reconsent');
  const needsNothing = input.documents.some((document) => document.updatePolicy === 'notify');

  const items = input.documents.map((document) => {
    const date = formatMailDate(editionDate(document.version), language);
    const title = language === 'en' ? TITLE_EN[document.document] : document.title;
    const note =
      language === 'en'
        ? document.updatePolicy === 'reconsent'
          ? `Edition of ${date}. Confirm your consent in Privacy settings`
          : `Edition of ${date}`
        : document.updatePolicy === 'reconsent'
          ? `Редакция от ${date}. Подтвердите согласие в разделе «Приватность»`
          : `Редакция от ${date}`;
    return { label: title, url: mailUrl(input.webBaseUrl, document.path, language), note };
  });

  if (language === 'en') {
    const blocks: MailBlock[] = [
      {
        kind: 'paragraph',
        text: 'We have published new editions of StreamKit documents. The binding version is the Russian one; the English text is a translation.',
      },
      { kind: 'links', items },
    ];
    if (needsNothing) {
      blocks.push({
        kind: 'paragraph',
        text: 'The terms, the policy and the offer do not need to be accepted again: they apply as you keep using the service.',
      });
    }
    if (needsConsent) {
      blocks.push({
        kind: 'notice',
        text: 'A new edition of a consent applies only once you confirm it. Until then your data is processed under the previous edition, and your access does not change.',
      });
    }
    blocks.push({ kind: 'action', label: 'Open Privacy settings', url: privacyUrl });

    return {
      to: input.email,
      ...renderMail({
        language,
        subject: 'StreamKit: documents updated',
        preheader: items.map((item) => item.label).join(', '),
        heading: 'Documents updated',
        greeting: `Hello, ${input.displayName}!`,
        blocks,
        footnote:
          'This is a service email: we notify every account holder about new editions of the documents they have accepted.',
      }),
    };
  }

  const blocks: MailBlock[] = [
    { kind: 'paragraph', text: 'Мы опубликовали новые редакции документов StreamKit.' },
    { kind: 'links', items },
  ];
  if (needsNothing) {
    blocks.push({
      kind: 'paragraph',
      text: 'Соглашение, политику и оферту заново принимать не нужно: новая редакция действует, пока вы пользуетесь сервисом.',
    });
  }
  if (needsConsent) {
    blocks.push({
      kind: 'notice',
      text: 'Новая редакция согласия действует только после подтверждения. До него данные обрабатываются по прежней редакции, а доступ к сервису не меняется.',
    });
  }
  blocks.push({ kind: 'action', label: 'Открыть раздел «Приватность»', url: privacyUrl });

  return {
    to: input.email,
    ...renderMail({
      language,
      subject: 'StreamKit: документы обновлены',
      preheader: items.map((item) => item.label).join(', '),
      heading: 'Документы обновлены',
      greeting: `Здравствуйте, ${input.displayName}!`,
      blocks,
      footnote:
        'Это служебное письмо: о новых редакциях принятых документов мы сообщаем каждому владельцу учётной записи.',
    }),
  };
}
