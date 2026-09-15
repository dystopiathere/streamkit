import type { ConsentDocument } from '@prisma/client';

/**
 * Реестр юридических документов и их актуальных версий.
 *
 * Версия — это дата редакции; вторая редакция того же дня — с суффиксом `.2`
 * (в шапке документа — «Редакция № 2»). Когда текст документа меняется, здесь появляется
 * новая версия, и пользователи, согласившиеся со старой, считаются НЕ принявшими
 * новую: их нужно попросить согласиться заново. Без этого реестра невозможно
 * доказать, на какую именно редакцию человек дал согласие.
 *
 * Сами тексты лежат в apps/web/public/legal и отдаются фронтом; здесь только
 * метаданные.
 */
export interface LegalDocument {
  document: ConsentDocument;
  version: string;
  title: string;
  /** Путь на фронте, где опубликован текст. */
  path: string;
  /**
   * Опубликован ли документ. Неопубликованный не показывается в разделе
   * «Приватность» и не принимается: согласие на текст, которого нет, — не
   * согласие ни на что.
   */
  published: boolean;
  /** Обязателен ли документ для регистрации. */
  requiredOnRegister: boolean;
  /**
   * Принимается только при оплате, а не кнопкой в разделе «Приватность».
   * Согласие на автоматические списания без выбора тарифа и суммы — не
   * согласие ни на что: человек не знает, сколько и когда с него спишут.
   */
  acceptedAtCheckout: boolean;
}

export const LEGAL_DOCUMENTS: Record<ConsentDocument, LegalDocument> = {
  TERMS: {
    document: 'TERMS',
    // Вторая редакция того же дня: приватные комнаты и ответственность
    // стримера за показ гостей, служебные письма, подсудность потребителя.
    version: '2026-09-15.2',
    title: 'Пользовательское соглашение',
    path: '/legal/terms',
    published: true,
    requiredOnRegister: true,
    acceptedAtCheckout: false,
  },
  PRIVACY: {
    document: 'PRIVACY',
    // Получатели данных (Yandex Cloud, ЮKassa, площадки), письма, гости комнат,
    // сроки хранения платежей. Согласившиеся со старой увидят needsRenewal:
    // это и есть смысл реестра версий.
    version: '2026-09-15.2',
    title: 'Политика конфиденциальности',
    path: '/legal/privacy',
    published: true,
    requiredOnRegister: true,
    acceptedAtCheckout: false,
  },
  PERSONAL_DATA: {
    document: 'PERSONAL_DATA',
    version: '2026-09-15.2',
    title: 'Согласие на обработку персональных данных',
    path: '/legal/personal-data',
    published: true,
    requiredOnRegister: true,
    acceptedAtCheckout: false,
  },
  COOKIE_ANALYTICS: {
    document: 'COOKIE_ANALYTICS',
    version: '2026-09-15',
    title: 'Аналитические cookie',
    path: '/legal/cookies',
    published: true,
    requiredOnRegister: false,
    acceptedAtCheckout: false,
  },
  MARKETING: {
    document: 'MARKETING',
    version: '2026-09-11',
    title: 'Рекламные рассылки',
    path: '/legal/marketing',
    // Рекламных рассылок нет, и текста согласия на них тоже нет.
    published: false,
    requiredOnRegister: false,
    acceptedAtCheckout: false,
  },
  SUBSCRIPTION_OFFER: {
    document: 'SUBSCRIPTION_OFFER',
    // Письмо за три дня до списания, возврат пропорционально дням.
    version: '2026-09-15.2',
    title: 'Оферта тарифа «Про» и автоматические списания',
    path: '/legal/subscription',
    published: true,
    requiredOnRegister: false,
    acceptedAtCheckout: true,
  },
};

/** Документы, текст которых опубликован: только их показывают и принимают. */
export function publishedDocuments(): LegalDocument[] {
  return Object.values(LEGAL_DOCUMENTS).filter((document) => document.published);
}

export const REQUIRED_ON_REGISTER: ConsentDocument[] = Object.values(LEGAL_DOCUMENTS)
  .filter((document) => document.requiredOnRegister)
  .map((document) => document.document);

/**
 * Редакция условий для гостя приватной комнаты.
 *
 * Отдельно от `LEGAL_DOCUMENTS`: тот реестр — про согласия ПОЛЬЗОВАТЕЛЯ, и его
 * ключ — перечисление `ConsentDocument` в журнале пользователя. У гостя учётной
 * записи нет, его согласие пишется в `GuestConsent`, и смешивать два журнала
 * значило бы показать в разделе «Приватность» стримера документ, которого он не
 * принимал. Текст — `/legal/room-guest`; меняется он — меняется и эта дата.
 */
export const ROOM_GUEST_TERMS = {
  version: '2026-09-15',
  title: 'Условия участия в комнате',
  path: '/legal/room-guest',
} as const;
