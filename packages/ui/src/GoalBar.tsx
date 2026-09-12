import {
  type GoalState,
  type GoalWidgetConfig,
  formatMoney,
  goalProgress,
} from '@streamkit/contracts';
import { textStyleToCss } from './text-style';

export interface GoalBarProps {
  config: GoalWidgetConfig;
  /** null — сервер ещё не прислал состояние: показываем пустую полосу. */
  state: GoalState | null;
}

/**
 * Полоса прогресса цели.
 *
 * Сумма подписана числом, а не только длиной полосы: полоса отвечает на вопрос
 * «далеко ли до конца», а зритель, решающий задонатить, хочет знать «сколько не
 * хватает». Одно без другого работает хуже.
 */
export function GoalBar({ config, state }: GoalBarProps): React.JSX.Element {
  const raisedMinor = state?.raisedMinor ?? 0;
  const targetMinor = state?.targetMinor ?? config.targetMinor;
  const currency = state?.currency ?? config.currency;
  const progress = goalProgress({ raisedMinor, targetMinor });

  const text = textStyleToCss(config.text);
  const labelSize = Math.round(config.text.fontSize * 0.75);

  return (
    <div
      data-testid="goal-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ ...text, fontSize: config.text.fontSize, fontWeight: 700 }}>{config.title}</div>

      <div
        // Роль и значения — для доступности превью в дашборде; в OBS их никто не
        // читает, но и стоят они ничего.
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={targetMinor}
        aria-valuenow={raisedMinor}
        style={{
          position: 'relative',
          height: Math.max(12, Math.round(config.text.fontSize * 0.5)),
          borderRadius: 999,
          background: config.trackColor,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            background: config.barColor,
            // Плавно, но недолго: донат должен быть заметен как движение, а не
            // как медленное наполнение, которое кончится уже после алерта.
            transition: 'width 600ms ease-out',
          }}
        />
      </div>

      {config.showAmounts ? (
        <div
          style={{
            ...text,
            fontSize: labelSize,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ fontWeight: 700 }}>
            {formatMoney({ amountMinor: raisedMinor, currency })}
          </span>
          <span>{formatMoney({ amountMinor: targetMinor, currency })}</span>
        </div>
      ) : null}
    </div>
  );
}
