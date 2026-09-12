import { type TopDonorsState, type TopDonorsWidgetConfig, formatMoney } from '@streamkit/contracts';
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
    <div
      data-testid="top-donors"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      {config.title ? (
        <div style={{ ...text, fontSize: config.text.fontSize, fontWeight: 700 }}>
          {config.title}
        </div>
      ) : null}

      {entries.map((entry, index) => (
        <div
          key={entry.username}
          style={{
            ...text,
            fontSize: rowSize,
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
                currency: state?.currency ?? config.currency,
              })}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
