import { ROULETTE_COLORS, type WidgetType } from '@streamkit/contracts';
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
      {type === 'roulette' ? (
        // Рулетка — составной меткой: три сегмента цветов колеса вместо ещё
        // одного оттенка, неотличимого от соседних (см. `--color-bar-latest`).
        <span
          aria-hidden="true"
          className="flex h-3 w-1.5 shrink-0 flex-col overflow-hidden rounded-[1px]"
        >
          {ROULETTE_COLORS.slice(0, 3).map((color) => (
            <span key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="h-3 w-1.5 shrink-0 rounded-[1px]"
          style={{ backgroundColor: `var(--color-bar-${type})` }}
        />
      )}
      {t(`widgets.type.${type}`)}
    </span>
  );
}
