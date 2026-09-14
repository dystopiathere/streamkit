import type { ConsentDocument } from '@prisma/client';

/**
 * Реестр юридических документов и их актуальных версий.
 *
 * Версия — это дата редакции. Когда текст документа меняется, здесь появляется
 * новая версия, и пользователи, согласившиеся со старой, считаются НЕ принявшими
 * новую: их нужно попросить согласиться заново. Без этого реестра невозможно
 * доказать, на какую именно редакцию человек дал согласие.
 *
 * Сами тексты лежат в docs/legal и отдаются фронтом; здесь только метаданные.
 */
export interface LegalDocument {
  document: ConsentDocument;
  version: string;
  title: string;
  /** Путь на фронте, где опубликован текст. */
  path: string;
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
    // Заполнен раздел об оплате: появился платный тариф.
    version: '2026-09-14',
    title: 'Пользовательское соглашение',
    path: '/legal/terms',
    requiredOnRegister: true,
    acceptedAtCheckout: false,
  },
  PRIVACY: {
    document: 'PRIVACY',
    // Добавлен срок хранения снимков метрик — новый раздел данных, новая
    // редакция. Согласившиеся со старой увидят needsRenewal: это и есть смысл
    // реестра версий.
    version: '2026-09-12',
    title: 'Политика конфиденциальности',
    path: '/legal/privacy',
    requiredOnRegister: true,
    acceptedAtCheckout: false,
  },
  PERSONAL_DATA: {
    document: 'PERSONAL_DATA',
    version: '2026-09-11',
    title: 'Согласие на обработку персональных данных',
    path: '/legal/personal-data',
    requiredOnRegister: true,
    acceptedAtCheckout: false,
  },
  COOKIE_ANALYTICS: {
    document: 'COOKIE_ANALYTICS',
    version: '2026-09-11',
    title: 'Аналитические cookie',
    path: '/legal/cookies',
    requiredOnRegister: false,
    acceptedAtCheckout: false,
  },
  MARKETING: {
    document: 'MARKETING',
    version: '2026-09-11',
    title: 'Рекламные рассылки',
    path: '/legal/marketing',
    requiredOnRegister: false,
    acceptedAtCheckout: false,
  },
  SUBSCRIPTION_OFFER: {
    document: 'SUBSCRIPTION_OFFER',
    version: '2026-09-14',
    title: 'Оферта тарифа «Про» и автоматические списания',
    path: '/legal/subscription',
    requiredOnRegister: false,
    acceptedAtCheckout: true,
  },
};

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
  version: '2026-09-13',
  title: 'Условия участия в комнате',
  path: '/legal/room-guest',
} as const;
