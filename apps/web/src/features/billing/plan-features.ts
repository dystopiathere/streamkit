import { type Plan, PLAN_FEATURES } from '@streamkit/contracts';
import type { TFunction } from 'i18next';

/**
 * Состав тарифа строками — из `PLAN_FEATURES`, а не из словаря.
 *
 * Лимиты живут в контрактах, и их читают гейты на сервере. Если бы список на
 * странице был отдельным текстом, он разошёлся бы с сервером на первой же
 * правке: в карточке «до 4 виджетов», а создать нельзя пятый. Здесь берётся то
 * же число, что проверяет API, а перевод отвечает только за слова вокруг него.
 *
 * Одна функция на страницу тарифа, главную и плашки: список тарифа должен
 * читаться одинаково везде, где его показывают.
 */
export function planFeatureList(plan: Plan, t: TFunction): string[] {
  const features = PLAN_FEATURES[plan];
  return [
    features.widgets === null
      ? t('billing.features.widgetsUnlimited')
      : t('billing.features.widgets', { count: features.widgets }),
    features.platforms === null
      ? t('billing.features.platformsUnlimited')
      : t('billing.features.platforms', { count: features.platforms }),
    ...(features.rooms ? [t('billing.features.rooms')] : []),
    ...(features.advancedStyling ? [t('billing.features.styling')] : []),
  ];
}
