import {
  type GoalState,
  type GoalWidgetConfig,
  formatMoney,
  goalProgress,
} from '@streamkit/contracts';
import { isPositioned, slotCss, WidgetFrame } from './slots';
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
  const currency = state?.currency ?? 'RUB';
  const progress = goalProgress({ raisedMinor, targetMinor });

  const text = textStyleToCss(config.text);
  const labelSize = Math.round(config.text.fontSize * 0.75);
  const slots = config.slots;
  const barHeight = Math.max(12, Math.round((slots.bar.fontSize ?? config.text.fontSize) * 0.5));

  return (
    <WidgetFrame
      testId="goal-bar"
      background={config.background}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 16,
      }}
    >
      <div
        data-slot="title"
        style={{
          ...text,
          ...slotCss(slots.title, config.text.fontSize),
          fontWeight: 700,
        }}
      >
        {config.title}
      </div>

      <div
        data-slot="bar"
        // Роль и значения — для доступности превью в дашборде; в OBS их никто не
        // читает, но и стоят они ничего.
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={targetMinor}
        aria-valuenow={raisedMinor}
        style={{
          position: 'relative',
          height: barHeight,
          borderRadius: config.barImageUrl ? 0 : 999,
          background: config.trackImageUrl ? undefined : config.trackColor,
          overflow: 'hidden',
          ...slotCss(slots.bar, config.text.fontSize),
          // Полоса в потоке занимает всю ширину кадра, а вынутая из потока не
          // занимает никакой: ширину ей приходится назначить. Две трети кадра —
          // чтобы она осталась полосой, а не отрезком.
          ...(isPositioned(slots.bar) ? { width: '66%' } : {}),
        }}
      >
        {config.trackImageUrl ? (
          <img
            src={config.trackImageUrl}
            alt=""
            referrerPolicy="no-referrer"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        ) : null}

        {/* Заполнение — слой во всю полосу, ОБРЕЗАННЫЙ по прогрессу, а не
            растянутый до него. Для цвета разницы нет, а картинка, сжатая до
            10 % прогресса, теряет и рисунок, и пропорции — выглядит это как
            ошибка вёрстки, а не как начало сбора. Отрезается правая часть:
            `inset()` считает отступы от краёв. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: config.barImageUrl ? undefined : config.barColor,
            clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
            // Плавно, но недолго: донат должен быть заметен как движение, а не
            // как медленное наполнение, которое кончится уже после алерта.
            transition: 'clip-path 600ms ease-out',
          }}
        >
          {config.barImageUrl ? (
            <img
              src={config.barImageUrl}
              alt=""
              referrerPolicy="no-referrer"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : null}
        </div>
      </div>

      {config.showAmounts ? (
        <div
          data-slot="amount"
          style={{
            ...text,
            ...slotCss(slots.amount, labelSize),
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
    </WidgetFrame>
  );
}
