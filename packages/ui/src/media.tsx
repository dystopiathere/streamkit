import { isVideoUrl } from '@streamkit/contracts';
import { type CSSProperties, useEffect, useRef } from 'react';

export { isVideoUrl };

/**
 * Картинка или видео по ссылке — одним элементом для всех рендереров.
 *
 * Видео по умолчанию — без звука, по кругу и сразу: браузер без действия
 * пользователя запускает только беззвучное видео, со звуком оно молча не
 * стартовало бы. `playsInline` — чтобы мобильный Safari в предпросмотре не
 * открывал его на весь экран.
 *
 * Видео всегда идёт по кругу, со звуком тоже: время показа оповещения задаёт
 * сценарий, а не длина ролика. Короткое видео повторяется, пока оповещение на
 * экране; длинное обрывается, когда оповещение уходит (звук глушится с началом
 * ухода, картинка — с концом анимации ухода). Звук включается уже после старта
 * — браузер-сорс OBS это разрешает, а обычная вкладка отказывает, и тогда видео
 * играет без звука, а не стоит на первом кадре.
 *
 * `referrerPolicy` у `<video>` нет; адрес страницы с токеном закрывает
 * политика страницы оверлея (`no-referrer` в его index.html).
 */
export function Media({
  src,
  style,
  slot,
  sound = null,
}: {
  src: string;
  style?: CSSProperties;
  /** Элемент кадра для раскладки (`data-slot`). */
  slot?: string;
  /** Играть звуковую дорожку видео с этой громкостью (0–1). */
  sound?: { volume: number } | null;
}): React.JSX.Element {
  if (!isVideoUrl(src)) {
    return <img data-slot={slot} src={src} alt="" referrerPolicy="no-referrer" style={style} />;
  }
  return <Video src={src} style={style} slot={slot} volume={sound ? sound.volume : null} />;
}

function Video({
  src,
  style,
  slot,
  volume,
}: {
  src: string;
  style?: CSSProperties;
  slot?: string;
  volume: number | null;
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null);

  // Громкость и звук — свойства элемента, а не атрибуты разметки: `muted` в
  // JSX React ставит только атрибутом, и после монтирования его не меняет.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (volume === null) {
      // Звук сняли (оповещение уходит) — глушим сразу, картинка доигрывает уход.
      element.muted = true;
      return;
    }
    element.volume = Math.min(1, Math.max(0, volume));
    element.muted = false;
    // `play()` без промиса бывает (jsdom, старые движки) — отказ ловится, только
    // когда промис есть.
    element.play()?.catch(() => {
      element.muted = true;
      element.play()?.catch(() => undefined);
    });
  }, [volume, src]);

  return (
    <video
      ref={video}
      data-slot={slot}
      src={src}
      autoPlay
      loop
      muted
      playsInline
      disablePictureInPicture
      preload="auto"
      style={style}
    />
  );
}
