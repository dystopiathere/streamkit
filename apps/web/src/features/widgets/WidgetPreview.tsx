import type {
  AlertWidgetConfig,
  GoalWidgetConfig,
  TimerWidgetConfig,
  TopDonorsWidgetConfig,
  WidgetState,
  WidgetType,
} from '@streamkit/contracts';
import {
  AlertAnimationStyles,
  AlertCard,
  GoalBar,
  TimerDisplay,
  TopDonorsList,
} from '@streamkit/ui';

/** Событие-пустышка: показывает, как алерт выглядит в эфире. */
const PREVIEW_EVENT = {
  username: 'Зритель',
  message: 'Спасибо за стрим! Держи на кофе.',
  amount: { amountMinor: 50_000, currency: 'RUB' as const },
  type: 'donation' as const,
};

/**
 * Предпросмотр виджета.
 *
 * Использует ТЕ ЖЕ рендереры, что и overlay: иначе расхождение «в редакторе
 * одно, на стриме другое» — лишь вопрос времени.
 *
 * Состояние берётся настоящее, если оно уже посчитано сервером, и подменяется
 * правдоподобным примером, если нет. Пустая полоса и пустой топ ничего не
 * говорят о том, как виджет будет выглядеть в эфире, а настраивают его обычно
 * до первого доната.
 */
export function WidgetPreview({
  type,
  config,
  state,
}: {
  type: WidgetType;
  config: Record<string, unknown>;
  state: WidgetState | null;
}): React.JSX.Element {
  return (
    // Клетчатый фон вместо сплошного: у оверлея прозрачный фон, и на
    // однотонной подложке невозможно оценить читаемость обводки.
    <div
      className="flex h-64 items-center justify-center overflow-hidden rounded-lg"
      style={{
        backgroundImage:
          'linear-gradient(45deg, #2a2a35 25%, transparent 25%), linear-gradient(-45deg, #2a2a35 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a35 75%), linear-gradient(-45deg, transparent 75%, #2a2a35 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
      }}
    >
      <Surface type={type} config={config} state={state} />
    </div>
  );
}

function Surface({
  type,
  config,
  state,
}: {
  type: WidgetType;
  config: Record<string, unknown>;
  state: WidgetState | null;
}): React.JSX.Element | null {
  switch (type) {
    case 'alerts':
      return (
        <>
          <AlertAnimationStyles />
          <AlertCard
            event={PREVIEW_EVENT}
            config={config as unknown as AlertWidgetConfig}
            animate={false}
          />
        </>
      );

    case 'goal': {
      const goal = config as unknown as GoalWidgetConfig;
      return (
        <GoalBar
          config={goal}
          state={
            state?.kind === 'goal'
              ? state
              : {
                  kind: 'goal',
                  // Треть цели: полоса видна, но очевидно, что это пример.
                  raisedMinor: Math.round(goal.targetMinor / 3),
                  targetMinor: goal.targetMinor,
                  currency: goal.currency,
                  offsetMinor: 0,
                }
          }
        />
      );
    }

    case 'timer': {
      const timer = config as unknown as TimerWidgetConfig;
      return (
        <TimerDisplay
          config={timer}
          state={
            state?.kind === 'timer'
              ? state
              : {
                  kind: 'timer',
                  endsAt: null,
                  pausedSeconds: timer.initialSeconds,
                  serverNow: new Date().toISOString(),
                }
          }
        />
      );
    }

    case 'top-donors': {
      const top = config as unknown as TopDonorsWidgetConfig;
      return (
        <TopDonorsList
          config={top}
          state={
            state?.kind === 'top-donors' && state.entries.length > 0
              ? state
              : {
                  kind: 'top-donors',
                  currency: top.currency,
                  entries: SAMPLE_DONORS.slice(0, top.limit),
                }
          }
        />
      );
    }
  }
}

const SAMPLE_DONORS = [
  { username: 'Аня', amountMinor: 250_000, count: 4 },
  { username: 'Кирилл', amountMinor: 150_000, count: 2 },
  { username: 'Аноним', amountMinor: 90_000, count: 7 },
  { username: 'Даша', amountMinor: 50_000, count: 1 },
  { username: 'Пётр', amountMinor: 30_000, count: 3 },
  { username: 'Лена', amountMinor: 20_000, count: 2 },
  { username: 'Максим', amountMinor: 15_000, count: 1 },
  { username: 'Соня', amountMinor: 12_000, count: 2 },
  { username: 'Игорь', amountMinor: 9_000, count: 1 },
  { username: 'Вика', amountMinor: 5_000, count: 1 },
];
