import {
  type Widget,
  type WidgetState,
  formatDuration,
  formatMinorForInput,
  hasWidgetState,
  parseMajorToMinor,
} from '@streamkit/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button, Card, Input, Label } from '@streamkit/app-kit';
import { ApiError } from '@/lib/api';
import { useWidgetCommand, useWidgetState } from './queries';
import { formatMoney, intlLocale } from '@/lib/locale';

/**
 * Управление состоянием виджета из дашборда.
 *
 * Отдельно от формы настроек, потому что это разные вещи по последствиям:
 * настройки применяются по кнопке «Сохранить», а «запустить таймер» действует
 * немедленно и видно зрителям. Смешать их в одной форме значило бы запускать
 * марафон случайным нажатием Enter.
 */
export function WidgetStateControls({ widget }: { widget: Widget }): React.JSX.Element | null {
  const { t } = useTranslation();
  const hasState = hasWidgetState(widget.type);
  const state = useWidgetState(widget.id, hasState);
  const command = useWidgetCommand(widget.id);

  if (!hasState) return null;

  const run = async (input: Parameters<typeof command.mutateAsync>[0]): Promise<void> => {
    try {
      await command.mutateAsync(input);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  };

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">{t('widgets.section.state')}</h2>

      {widget.type === 'goal' ? (
        <GoalControls
          state={state.data ?? null}
          isPending={command.isPending}
          onSubmit={(offsetMinor) => void run({ kind: 'goal', offsetMinor })}
        />
      ) : null}

      {widget.type === 'timer' ? (
        <TimerControls
          state={state.data ?? null}
          isPending={command.isPending}
          onAction={(action, seconds) => void run({ kind: 'timer', action, seconds })}
        />
      ) : null}

      {widget.type === 'top-donors' ? <TopDonorsSummary state={state.data ?? null} /> : null}
    </Card>
  );
}

function GoalControls({
  state,
  isPending,
  onSubmit,
}: {
  state: WidgetState | null;
  isPending: boolean;
  onSubmit: (offsetMinor: number) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const raised = state?.kind === 'goal' ? state : null;

  // Поле в рублях, состояние в копейках. Просить у стримера копейки значит
  // заставлять его печатать 100000 там, где он думает про тысячу.
  //
  // Начальное значение — заданное смещение, а не ноль. Поле, которое всегда
  // открывается нулём, выглядит как потерянная настройка, а нажатие «Сохранить»
  // рядом с ним эту настройку действительно затирало.
  const [value, setValue] = useState(() => formatMinorForInput(raised?.offsetMinor ?? 0));
  const offsetMinor = parseMajorToMinor(value);

  // Снимок состояния приходит запросом, то есть уже после первого рендера:
  // без этого поле так и осталось бы нулём, ради которого всё и затевалось.
  // Правка состояния в рендере, а не в эффекте — так React и предлагает
  // подстраивать состояние под изменившийся пропс.
  //
  // Своё же значение не переписываем: иначе набранное стиралось бы на каждом
  // обновлении состояния с сервера.
  const stored = raised?.offsetMinor ?? null;
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    if (stored !== null && parseMajorToMinor(value) !== stored) {
      setValue(formatMinorForInput(stored));
    }
  }

  return (
    <div className="space-y-3">
      {raised ? (
        <p className="text-sm">
          {t('widgets.state.raised')}:{' '}
          <span className="font-medium tabular-nums">
            {formatMoney({ amountMinor: raised.raisedMinor, currency: raised.currency })}
          </span>{' '}
          / {formatMoney({ amountMinor: raised.targetMinor, currency: raised.currency })}
        </p>
      ) : null}

      <div>
        <Label htmlFor="goal-offset">
          {t('widgets.field.offsetMinor')}
          {raised ? `, ${CURRENCY_SIGNS[raised.currency] ?? raised.currency}` : ''}
        </Label>
        <div className="flex gap-2">
          <Input
            id="goal-offset"
            type="number"
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="max-w-40"
          />
          <Button
            variant="secondary"
            isLoading={isPending}
            disabled={offsetMinor === null}
            onClick={() => offsetMinor !== null && onSubmit(offsetMinor)}
          >
            {t('common.save')}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted">{t('widgets.hint.offsetMinor')}</p>
      </div>
    </div>
  );
}

const CURRENCY_SIGNS: Record<string, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  KZT: '₸',
  BYN: 'Br',
  UAH: '₴',
};

function TimerControls({
  state,
  isPending,
  onAction,
}: {
  state: WidgetState | null;
  isPending: boolean;
  onAction: (action: 'start' | 'pause' | 'reset' | 'add', seconds?: number) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const timer = state?.kind === 'timer' ? state : null;
  const running = timer?.endsAt !== null && timer?.endsAt !== undefined;

  return (
    <div className="space-y-3">
      {timer ? (
        // Идущий таймер показываем моментом окончания, а не бегущим остатком:
        // в настройках нужен ответ на вопрос «когда это кончится», а живой
        // отсчёт и так идёт в предпросмотре рядом.
        <p className="text-sm">
          {running && timer.endsAt ? (
            <>
              <span className="text-muted">{t('widgets.state.until')} </span>
              <span className="font-medium tabular-nums">
                {new Date(timer.endsAt).toLocaleTimeString(intlLocale(), {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </>
          ) : (
            <>
              <span className="font-medium tabular-nums">
                {formatDuration(timer.pausedSeconds ?? 0)}
              </span>{' '}
              <span className="text-muted">{t('widgets.state.paused')}</span>
            </>
          )}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" isLoading={isPending} onClick={() => onAction('start')}>
          {t('widgets.state.start')}
        </Button>
        <Button variant="secondary" disabled={!running} onClick={() => onAction('pause')}>
          {t('widgets.state.pause')}
        </Button>
        <Button variant="ghost" onClick={() => onAction('reset')}>
          {t('widgets.state.reset')}
        </Button>
        <Button variant="ghost" onClick={() => onAction('add', 600)}>
          {t('widgets.state.addTenMinutes')}
        </Button>
      </div>
    </div>
  );
}

/**
 * У топа нет состояния, которым можно управлять: он целиком выводится из
 * истории событий. Показываем то, что прямо сейчас увидят зрители — иначе
 * проверить настройки периода и валюты можно только через OBS.
 */
function TopDonorsSummary({ state }: { state: WidgetState | null }): React.JSX.Element {
  const { t } = useTranslation();
  if (state?.kind !== 'top-donors' || state.entries.length === 0) {
    return <p className="text-sm text-muted">{t('widgets.state.topEmpty')}</p>;
  }

  return (
    <ol className="space-y-1 text-sm">
      {state.entries.map((entry) => (
        <li key={entry.username} className="flex justify-between gap-3">
          <span className="truncate">{entry.username}</span>
          <span className="shrink-0 tabular-nums">
            {formatMoney({ amountMinor: entry.amountMinor, currency: state.currency })}
          </span>
        </li>
      ))}
    </ol>
  );
}
