import type { WidgetBackground, WidgetSlot } from '@streamkit/contracts';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Продвинутое оформление в кадре: позиции элементов и фоновый слой.
 *
 * Тариф здесь не проверяется — и не должен: конфиг приходит уже приведённым к
 * тарифу (`applyPlanToConfig`), и решение «что показать» принимается один раз на
 * сервере, а не в каждом рендерере. Рендерер рисует то, что ему дали.
 */

/** Задана ли позиция: оба процента, а не один. Половина позиции — не позиция. */
export function isPositioned(slot: WidgetSlot | undefined): boolean {
  return slot?.x !== null && slot?.x !== undefined && slot.y !== null && slot.y !== undefined;
}

/**
 * Стили элемента кадра: позиция и переопределения оформления.
 *
 * Позиция — проценты с переносом на половину размера: перетаскивая элемент,
 * стример целится его СЕРЕДИНОЙ, а не левым верхним углом, иначе крупный
 * заголовок уезжает из кадра при позиции 100 %.
 *
 * Без позиции стили пустые, и элемент остаётся в обычном потоке — так выглядит
 * виджет без продвинутого оформления и любой конфиг, сохранённый до его
 * появления.
 */
export function slotCss(slot: WidgetSlot | undefined, fontSize: number): CSSProperties {
  const style: CSSProperties = { fontSize: slot?.fontSize ?? fontSize };
  if (slot?.color) style.color = slot.color;
  if (isPositioned(slot)) {
    style.position = 'absolute';
    style.left = `${slot!.x!}%`;
    style.top = `${slot!.y!}%`;
    style.transform = 'translate(-50%, -50%)';
    // Элемент в потоке ограничен шириной кадра автоматически, вынутый из
    // потока — нет: длинный ник уехал бы за край, и в OBS этого не видно.
    style.maxWidth = '100%';
  }
  return style;
}

/**
 * Фон виджета — отдельным слоем ПОД содержимым.
 *
 * Слоем, а не свойством контейнера, из-за прозрачности: `opacity` на контейнере
 * притушила бы и текст, а полупрозрачная подложка под читаемым текстом — обычное
 * требование. `pointer-events: none` здесь не нужен: оверлей не принимает ввод
 * целиком, а в предпросмотре фон лежит под содержимым.
 */
export function WidgetBackgroundLayer({
  background,
}: {
  background: WidgetBackground | undefined;
}): React.JSX.Element | null {
  if (!background || (!background.color && !background.imageUrl)) return null;

  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    opacity: background.opacity,
    borderRadius: background.cornerRadius || undefined,
    background: background.color ?? undefined,
    overflow: 'hidden',
  };

  return (
    <div data-testid="widget-background" style={style}>
      {background.imageUrl ? (
        <img
          src={background.imageUrl}
          alt=""
          // Чужой хост не должен узнавать, на какой странице показана картинка:
          // адрес оверлея несёт токен, а Referer его бы выдал.
          referrerPolicy="no-referrer"
          style={{
            width: '100%',
            height: '100%',
            // «Плиткой» размножается сама картинка, поэтому здесь это не img, а
            // фон-повтор: img растянуть в плитку нечем.
            objectFit: background.fit === 'contain' ? 'contain' : 'cover',
            display: background.fit === 'tile' ? 'none' : 'block',
          }}
        />
      ) : null}
      {background.imageUrl && background.fit === 'tile' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url("${cssUrl(background.imageUrl)}")`,
            backgroundRepeat: 'repeat',
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Адрес в `url()` CSS.
 *
 * Схема уже проверила, что это https-адрес, но кавычка внутри значения закрыла
 * бы строку и вынесла бы остаток адреса в CSS как код. Экранируем, а не
 * доверяем: конфиг виджета правит пользователь, а оверлей открыт по публичной
 * ссылке.
 */
function cssUrl(url: string): string {
  return url.replace(/["\\]/g, (char) => `\\${char}`);
}

/**
 * Кадр виджета: фон, и внутри — содержимое.
 *
 * `position: relative` обязателен: от него отсчитываются проценты позиций.
 * Размер — весь браузер-сорс: его задаёт стример в OBS, и проценты считаются от
 * того, что он там задал.
 */
export function WidgetFrame({
  background,
  style,
  children,
  testId,
}: {
  background?: WidgetBackground;
  style?: CSSProperties;
  children: ReactNode;
  testId?: string;
}): React.JSX.Element {
  return (
    <div
      data-testid={testId}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <WidgetBackgroundLayer background={background} />
      {children}
    </div>
  );
}
