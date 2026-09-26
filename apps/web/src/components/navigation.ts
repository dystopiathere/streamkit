/**
 * Разделы дашборда — один список на шапку, меню профиля и карту в подвале.
 *
 * Два списка, потому что это два разных вопроса. Разделы кабинета — работа
 * со стримом, их открывают каждый день, и они стоят в шапке. Профиль —
 * аккаунт: площадки и источники донатов, вход, тариф, данные; их настраивают
 * один раз и открывают редко, и в шапке они вытесняли рабочие разделы в меню
 * под кнопкой уже на ноутбуке.
 */
export const DASHBOARD_SECTIONS = [
  { to: '/stream', label: 'nav.stream' },
  { to: '/widgets', label: 'nav.widgets' },
  { to: '/events', label: 'nav.events' },
  { to: '/analytics', label: 'nav.analytics' },
  { to: '/rooms', label: 'nav.rooms' },
] as const;

export const ACCOUNT_SECTIONS = [
  { to: '/account/platforms', label: 'nav.platforms' },
  { to: '/account/sources', label: 'nav.sources' },
  { to: '/account/security', label: 'nav.security' },
  { to: '/account/billing', label: 'nav.billing' },
  { to: '/account/referrals', label: 'nav.referrals' },
  { to: '/account/privacy', label: 'nav.privacy' },
] as const;

/** Раздел профиля, в который ведут подключение площадки и возврат с неё. */
export const PLATFORMS_PATH = '/account/platforms';
