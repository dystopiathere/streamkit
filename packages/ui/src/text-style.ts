import type { TextStyle } from '@streamkit/contracts';
import type { CSSProperties } from 'react';

/**
 * Оформление текста из конфига в инлайновые стили.
 *
 * Вынесено из `AlertCard`, потому что задача у всех типов виджетов одна: текст
 * поверх произвольного кадра игры. Обводка здесь не украшение — без неё белый
 * текст пропадает на светлой сцене, и заметить это можно только на записи
 * эфира.
 *
 * Стили инлайновые и целиком выводятся из конфига. Ни Tailwind, ни глобальный
 * CSS в рендерерах не используются: overlay обязан оставаться лёгким и не
 * зависеть от того, какие классы подключило приложение-хост.
 */
export function textStyleToCss(text: TextStyle): CSSProperties {
  return {
    fontFamily: `${text.fontFamily}, system-ui, sans-serif`,
    color: text.color,
    textTransform: text.uppercase ? 'uppercase' : 'none',
    // paintOrder не даёт штриху съесть тонкие части букв.
    WebkitTextStroke:
      text.strokeWidth > 0 ? `${text.strokeWidth}px ${text.strokeColor}` : undefined,
    paintOrder: 'stroke fill',
  };
}
