import type { LatestState, LatestWidgetConfig } from '@streamkit/contracts';
import { slotCss, WidgetFrame } from './slots';
import { renderHighlighted, templateVars } from './template';
import { textStyleToCss } from './text-style';

export interface LatestEventDisplayProps {
  config: LatestWidgetConfig;
  /** null — сервер ещё не прислал состояние. */
  state: LatestState | null;
}

/**
 * Последнее событие: «последний донат», «последний фолловер».
 *
 * Пока событий не было, виджет пуст, если стример не задал текст на этот
 * случай: подпись «пока никого» в углу кадра на свежем канале — не то, что
 * стример хотел показывать зрителям.
 */
export function LatestEventDisplay({
  config,
  state,
}: LatestEventDisplayProps): React.JSX.Element | null {
  const event = state?.event ?? null;
  if (!event && !config.emptyText) return null;

  const text = textStyleToCss(config.text);
  const titleSize = Math.round(config.text.fontSize * 0.5);
  const messageSize = Math.round(config.text.fontSize * 0.6);
  const message = event && config.showMessage ? event.message.trim() : '';

  return (
    <WidgetFrame
      testId="latest-event"
      background={config.background}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 4,
        padding: 16,
      }}
    >
      {config.title ? (
        <div data-slot="title" style={{ ...text, ...slotCss(config.slots.title, titleSize) }}>
          {config.title}
        </div>
      ) : null}

      <div
        data-slot="value"
        style={{
          ...text,
          ...slotCss(config.slots.value, config.text.fontSize),
          fontWeight: 700,
          maxWidth: '100%',
          wordBreak: 'break-word',
        }}
      >
        {event
          ? renderHighlighted(config.template, templateVars(event), config.text.highlightColor)
          : config.emptyText}
      </div>

      {message ? (
        <div
          data-slot="message"
          style={{
            ...text,
            ...slotCss(config.slots.message, messageSize),
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
