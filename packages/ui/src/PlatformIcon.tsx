import type { ChatPlatform } from '@streamkit/contracts';
import type { CSSProperties } from 'react';

/** Названия площадок чата — как их пишут сами площадки, на любом языке одинаково. */
export const PLATFORM_TITLES: Record<ChatPlatform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick',
};

/**
 * Значок площадки у строки мультичата.
 *
 * Инлайновый SVG, а не картинка с CDN площадки: оверлей висит поверх эфира, и
 * картинка, которая не догрузилась, оставила бы дыру перед каждым ником. Цвета
 * — фирменные, фон — свой у значка: он обязан читаться на любом кадре, как
 * текст с обводкой.
 *
 * Название площадки — в `aria-label` и `title`: в окне эфира и предпросмотре
 * значок читает скринридер, и «откуда сообщение» не должно передаваться только
 * цветом.
 */
export function PlatformIcon({
  platform,
  size = 16,
  style,
}: {
  platform: ChatPlatform;
  size?: number;
  style?: CSSProperties;
}): React.JSX.Element {
  const title = PLATFORM_TITLES[platform];
  return (
    <svg
      role="img"
      aria-label={title}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ display: 'inline-block', flexShrink: 0, ...style }}
    >
      <title>{title}</title>
      {platform === 'twitch' ? (
        <>
          <path d="M2.5 1 1 4v10h3.5v2h2l2-2h3L15 10.5V1z" fill="#9146FF" />
          <path d="M3 2.5h10.5v7.5l-2 2h-3.5l-2 2v-2H3z" fill="#FFFFFF" />
          <path d="M7 5h1.5v4H7zM10.5 5H12v4h-1.5z" fill="#9146FF" />
        </>
      ) : platform === 'kick' ? (
        <>
          <rect x="0.5" y="0.5" width="15" height="15" rx="3" fill="#53FC18" />
          <path
            d="M3.5 3h3v3h1.5V4.5h1.5V3h3v3h-1.5v1.5H9.5v1h1.5V10h1.5v3h-3v-1.5H8V10H6.5v3h-3z"
            fill="#000000"
          />
        </>
      ) : (
        <>
          <rect x="0.5" y="3" width="15" height="10.5" rx="3" fill="#FF0000" />
          <path d="M6.5 5.75v5l4.25-2.5z" fill="#FFFFFF" />
        </>
      )}
    </svg>
  );
}
