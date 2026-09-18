import type { ConsentDocument } from '@prisma/client';

/**
 * Реестр юридических документов и их актуальных версий.
 *
 * Версия — это дата редакции; следующая редакция того же дня — с суффиксом `.2`,
 * `.3` (в шапке документа — «Редакция № 2», «№ 3»). Когда текст документа меняется, здесь появляется
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
    // Четвёртая редакция: что происходит при приостановке доступа (раздел 6).
    // Третья — поручение стримера на обработку данных участников событий,
    // зрителей чата и гостей (раздел 13).
    version: '2026-09-17',
    title: 'Пользовательское соглашение',
    path: '/legal/terms',
    published: true,
    requiredOnRegister: true,
    acceptedAtCheckout: false,
  },
  PRIVACY: {
    document: 'PRIVACY',
    // Седьмая редакция: данные из Google (раздел 5) — что берём у YouTube,
    // зачем, кто видит, как удалить, и заявление Limited Use, без которого
    // Google не пропускает приложение с youtube.readonly. Шестая — подключение
    // DonationAlerts и почта из его профиля (раздел 2). Пятая — доступ
    // сотрудников через административную панель. Согласившиеся со старой
    // увидят needsRenewal: это и есть смысл реестра версий.
    version: '2026-09-18.2',
    title: 'Политика конфиденциальности',
    path: '/legal/privacy',
    published: true,
    requiredOnRegister: true,
    acceptedAtCheckout: false,
  },
  PERSONAL_DATA: {
    document: 'PERSONAL_DATA',
    // Данные третьих лиц — не в этом согласии, а в поручении из соглашения.
    version: '2026-09-15.3',
    title: 'Согласие на обработку персональных данных',
    path: '/legal/personal-data',
    published: true,
    requiredOnRegister: true,
    acceptedAtCheckout: false,
  },
  COOKIE_ANALYTICS: {
    document: 'COOKIE_ANALYTICS',
    // Статистика посещений появилась: что именно считается, где и сколько хранится.
    version: '2026-09-15.2',
    title: 'Статистика посещений (cookie)',
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
  // Вторая редакция: имя, изображение и голос — по поручению стримера.
  version: '2026-09-15.2',
  title: 'Условия участия в комнате',
  path: '/legal/room-guest',
} as const;
