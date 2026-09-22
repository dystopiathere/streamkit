import { type TopDonorsState, type TopDonorsWidgetConfig, formatMoney } from '@streamkit/contracts';
import { slotCss, WidgetFrame } from './slots';
import { textStyleToCss } from './text-style';

export interface TopDonorsListProps {
  config: TopDonorsWidgetConfig;
  /** null — сервер ещё не прислал состояние. */
  state: TopDonorsState | null;
}

/**
 * Таблица топа донатеров.
 *
 * Пустой список не рисует ни заголовка, ни рамки: на свежем канале виджет не
 * должен занимать место в кадре надписью «пока никого».
 */
export function TopDonorsList({ config, state }: TopDonorsListProps): React.JSX.Element | null {
  const entries = state?.entries ?? [];
  if (entries.length === 0) return null;

  const text = textStyleToCss(config.text);
  const rowSize = Math.round(config.text.fontSize * 0.7);

  return (
    <WidgetFrame
      testId="top-donors"
      background={config.background}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 16,
      }}
    >
      {config.title ? (
        <div
          data-slot="title"
          style={{ ...text, ...slotCss(config.slots.title, config.text.fontSize), fontWeight: 700 }}
        >
          {config.title}
        </div>
      ) : null}

      {/* Список — один элемент кадра, а не строки по отдельности: перетаскивать
          каждую строку отдельно бессмысленно, их число меняется само. */}
      <div
        data-slot="list"
        style={{
          ...slotCss(config.slots.list, rowSize),
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {entries.map((entry, index) => (
          <div
            key={entry.username}
            style={{
              ...text,
              fontSize: config.slots.list.fontSize ?? rowSize,
              color: config.slots.list.color ?? text.color,
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
            }}
          >
            {/* Место числом, а не медалью: медали читаются только для первых трёх,
              а список бывает до десяти. */}
            <span style={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>{index + 1}</span>
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.username}
            </span>
            {config.showAmounts ? (
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney({
                  amountMinor: entry.amountMinor,
                  currency: state?.currency ?? 'RUB',
                })}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </WidgetFrame>
  );
}
