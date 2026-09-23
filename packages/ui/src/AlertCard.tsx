import {
  type AlertEvent,
  type AlertScenarioConfig,
  alertSoundPlan,
  renderTemplate,
} from '@streamkit/contracts';
import type { CSSProperties } from 'react';
import { ALERT_ENTER_DURATION_MS } from './alert-animations';
import { Media } from './media';
import { slotCss, WidgetFrame } from './slots';
import { renderHighlighted, templateVars } from './template';

export interface AlertCardProps {
  event: Pick<AlertEvent, 'username' | 'message' | 'amount' | 'count' | 'type'>;
  /** Сценарий типа этого события — у каждого свои текст, картинка и оформление. */
  config: AlertScenarioConfig;
  /** Отключает анимацию входа — нужно в превью редактора, где карточка статична. */
  animate?: boolean;
  /**
   * Играть звук из видео картинки, если сценарий его выбрал. Только в
   * оверлее и только пока оповещение не уходит: предпросмотр в редакторе при
   * каждой правке формы звучать не должен, а звук после конца показа — это
   * звук, который стример не заказывал.
   */
  playSound?: boolean;
}

const LAYOUT_STYLES: Record<AlertScenarioConfig['layout'], CSSProperties> = {
  banner: { alignItems: 'center', justifyContent: 'flex-start', textAlign: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  side: { alignItems: 'flex-start', justifyContent: 'center', textAlign: 'left' },
};

/**
 * Рендерер alert-виджета. Один и тот же компонент показывается в браузер-сорсе
 * OBS и в превью редактора — иначе «в редакторе одно, на стриме другое»
 * становится вопросом времени.
 *
 * Стили инлайновые и целиком выводятся из конфига. Ни Tailwind, ни глобальный CSS
 * здесь не используются: overlay обязан оставаться лёгким и не зависеть от того,
 * какие классы подключило приложение-хост.
 */
export function AlertCard({
  event,
  config,
  animate = true,
  playSound = false,
}: AlertCardProps): React.JSX.Element {
  const sound = alertSoundPlan(config);
  const vars = templateVars(event);

  // Оба шаблона пишет пользователь. Подставленный текст выводится как текстовый
  // узел JSX — никакого innerHTML, иначе конфиг виджета становится XSS-вектором
  // на публично доступной странице.
  const message = renderTemplate(config.messageTemplate, vars);

  const textStyle: CSSProperties = {
    fontFamily: `${config.text.fontFamily}, system-ui, sans-serif`,
    color: config.text.color,
    textTransform: config.text.uppercase ? 'uppercase' : 'none',
    // Обводка — единственный способ сохранить читаемость поверх произвольной
    // картинки игры. paintOrder не даёт штриху съесть тонкие части букв.
    WebkitTextStroke:
      config.text.strokeWidth > 0
        ? `${config.text.strokeWidth}px ${config.text.strokeColor}`
        : undefined,
    paintOrder: 'stroke fill',
  };

  return (
    <WidgetFrame
      testId="alert-card"
      background={config.background}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 24,
        animation: animate
          ? `sk-${config.animationIn} ${ALERT_ENTER_DURATION_MS}ms ease-out both`
          : undefined,
        ...LAYOUT_STYLES[config.layout],
      }}
    >
      {config.imageUrl ? (
        <Media
          slot="image"
          src={config.imageUrl}
          sound={playSound && sound.kind === 'video' ? { volume: sound.volume } : null}
          style={{
            // Своя ширина из раскладки — высота по пропорциям картинки; иначе
            // прежнее «не больше 320 × 240».
            ...(config.slots.image.width
              ? { width: config.slots.image.width, height: 'auto' }
              : { maxWidth: 320, maxHeight: 240 }),
            objectFit: 'contain',
            ...slotCss(config.slots.image, config.text.fontSize),
          }}
        />
      ) : null}

      <div
        data-slot="title"
        style={{
          ...textStyle,
          ...slotCss(config.slots.title, config.text.fontSize),
          fontWeight: 700,
        }}
      >
        {/* Подсветка — свой цвет, и цвет слота её не заменяет: слот задаёт цвет
            самой строки, а подсветка выделяет в ней имя и сумму. */}
        {renderHighlighted(config.titleTemplate, vars, config.text.highlightColor)}
      </div>

      {message.trim().length > 0 ? (
        <div
          data-slot="message"
          style={{
            ...textStyle,
            ...slotCss(config.slots.message, Math.round(config.text.fontSize * 0.6)),
            fontWeight: 400,
            maxWidth: '90%',
            wordBreak: 'break-word',
          }}
        >
          {message}
        </div>
      ) : null}
    </WidgetFrame>
  );
}
