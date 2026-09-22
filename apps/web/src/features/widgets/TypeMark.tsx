import type { WidgetType } from '@streamkit/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@streamkit/app-kit';

/**
 * Тип виджета: полоса своего цвета и название.
 *
 * Цвет — метка, а не смысл: рядом всегда стоит название, и тип читается и без
 * цвета. Цвета — `--color-bar-*` из темы, проверенные валидатором dataviz.
 */
export function TypeMark({
  type,
  className,
}: {
  type: WidgetType;
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        aria-hidden="true"
        className="h-3 w-1.5 shrink-0 rounded-[1px]"
        style={{ backgroundColor: `var(--color-bar-${type})` }}
      />
      {t(`widgets.type.${type}`)}
    </span>
  );
}
