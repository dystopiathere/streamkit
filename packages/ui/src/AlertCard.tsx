import {
  type AlertEvent,
  type AlertScenarioConfig,
  formatMoney,
  renderTemplate,
} from '@streamkit/contracts';
import type { CSSProperties } from 'react';

export interface AlertCardProps {
  event: Pick<AlertEvent, 'username' | 'message' | 'amount' | 'count' | 'type'>;
  /** Сценарий типа этого события — у каждого свои текст, картинка и оформление. */
  config: AlertScenarioConfig;
  /** Отключает анимацию входа — нужно в превью редактора, где карточка статична. */
  animate?: boolean;
}

/** Переменные, которые выделяются цветом акцента: на них смотрит зритель. */
const HIGHLIGHTED_VARS = new Set(['username', 'amount', 'count']);

/**
 * Разбирает шаблон на части и подсвечивает имя донатера и сумму.
 *
 * Подстановка идёт по кускам шаблона, а не по готовой строке: если сначала
 * собрать текст, а потом искать в нём имя, то донатер с ником вроде «задонатил»
 * сломает разметку, а ник, совпадающий с частью шаблона, подсветит не то.
 */
function renderHighlighted(
  template: string,
  vars: Record<string, string>,
  highlightColor: string,
): React.JSX.Element[] {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const match = /^\{(\w+)\}$/.exec(part);
    const key = match?.[1];

    if (!key || vars[key] === undefined) {
      // Неизвестный плейсхолдер остаётся видимым текстом — пользователю проще
      // заметить опечатку в шаблоне, чем гадать, куда исчез кусок строки.
      return <span key={index}>{part}</span>;
    }

    return (
      <span key={index} style={HIGHLIGHTED_VARS.has(key) ? { color: highlightColor } : undefined}>
        {vars[key]}
      </span>
    );
  });
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
export function AlertCard({ event, config, animate = true }: AlertCardProps): React.JSX.Element {
  const amount = event.amount ? formatMoney(event.amount) : '';
  const vars = {
    username: event.username,
    amount,
    // Количество — биты, зрители рейда, месяцы, подарки — числом с разрядами:
    // «10 000 битов» читается, «10000» — нет.
    count: event.count === null ? '' : new Intl.NumberFormat('ru-RU').format(event.count),
    message: event.message,
    type: event.type,
  };

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
    <div
      data-testid="alert-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: '100%',
        height: '100%',
        padding: 24,
        boxSizing: 'border-box',
        animation: animate ? `sk-${config.animationIn} 400ms ease-out both` : undefined,
        ...LAYOUT_STYLES[config.layout],
      }}
    >
      {config.imageUrl ? (
        <img
          src={config.imageUrl}
          alt=""
          style={{ maxWidth: 320, maxHeight: 240, objectFit: 'contain' }}
        />
      ) : null}

      <div style={{ ...textStyle, fontSize: config.text.fontSize, fontWeight: 700 }}>
        {renderHighlighted(config.titleTemplate, vars, config.text.highlightColor)}
      </div>

      {message.trim().length > 0 ? (
        <div
          style={{
            ...textStyle,
            fontSize: Math.round(config.text.fontSize * 0.6),
            fontWeight: 400,
            maxWidth: '90%',
            wordBreak: 'break-word',
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
