import {
  type RouletteSpin,
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

/** Как часто переспрашивать историю рулетки, пока открыт редактор. */
const ROULETTE_REFRESH_MS = 15_000;

/**
 * Управление состоянием виджета из дашборда.
 *
 * Отдельно от формы настроек, потому что это разные вещи по последствиям:
 * настройки применяются по кнопке «Сохранить», а «запустить таймер» действует
 * немедленно и видно зрителям. Смешать их в одной форме значило бы запускать
 * марафон случайным нажатием Enter.
 */
export function WidgetStateControls({
  widget,
  onSpin,
}: {
  widget: Widget;
  /** Прокрут ушёл в эфир — предпросмотр проигрывает его же. */
  onSpin?: (spin: RouletteSpin) => void;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const hasState = hasWidgetState(widget.type);
  // История рулетки пополняется донатами, пока редактор открыт, а сокета
  // состояний у дашборда нет — переспрашиваем, как ленту событий.
  const state = useWidgetState(
    widget.id,
    hasState,
    widget.type === 'roulette' ? ROULETTE_REFRESH_MS : undefined,
  );
  const command = useWidgetCommand(widget.id);

  if (!hasState) return null;

  const run = async (
    input: Parameters<typeof command.mutateAsync>[0],
  ): Promise<WidgetState | null | undefined> => {
    try {
      return await command.mutateAsync(input);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
      return undefined;
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

      {widget.type === 'latest' ? <LatestSummary state={state.data ?? null} /> : null}

      {widget.type === 'roulette' ? (
        <RouletteControls
          state={state.data ?? null}
          isPending={command.isPending}
          onSpin={async () => {
            const next = await run({ kind: 'roulette', action: 'spin' });
            // Свежий прокрут — первый в истории: его же крутит предпросмотр.
            if (next?.kind === 'roulette' && next.spins[0]) onSpin?.(next.spins[0]);
          }}
          onClear={() => {
            if (window.confirm(t('widgets.roulette.clearConfirm'))) {
              void run({ kind: 'roulette', action: 'clear' });
            }
          }}
        />
      ) : null}
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
/** Что сейчас в кадре у «последнего события»: то, что там увидят зрители. */
function LatestSummary({ state }: { state: WidgetState | null }): React.JSX.Element {
  const { t } = useTranslation();
  const event = state?.kind === 'latest' ? state.event : null;
  if (!event) return <p className="text-sm text-muted">{t('widgets.state.latestEmpty')}</p>;
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
      <span className="min-w-0 truncate">
        <span className="font-medium">{event.username}</span>
        {event.amount ? (
          <span className="ml-2 tabular-nums">{formatMoney(event.amount)}</span>
        ) : null}
      </span>
      <time className="text-xs text-muted tabular-nums" dateTime={event.createdAt}>
        {new Date(event.createdAt).toLocaleString(intlLocale(), {
          dateStyle: 'short',
          timeStyle: 'short',
        })}
      </time>
    </p>
  );
}

/**
 * Рулетка: прокрут кнопкой и история прокрутов.
 *
 * Кнопка действует сразу и видна зрителям — поэтому здесь, а не в форме
 * настроек, как «запустить» у таймера. История — единственное место, где
 * стример видит, что выпало, если пропустил момент в кадре.
 */
function RouletteControls({
  state,
  isPending,
  onSpin,
  onClear,
}: {
  state: WidgetState | null;
  isPending: boolean;
  onSpin: () => Promise<void>;
  onClear: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const spins = state?.kind === 'roulette' ? state.spins : [];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Button onClick={() => void onSpin()} isLoading={isPending} className="w-full">
          {t('widgets.roulette.spin')}
        </Button>
        <p className="text-xs text-muted">{t('widgets.roulette.spinHint')}</p>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">{t('widgets.roulette.history')}</h3>
          {spins.length > 0 ? (
            <Button variant="ghost" className="-my-1 px-2 py-1 text-xs" onClick={onClear}>
              {t('widgets.roulette.clear')}
            </Button>
          ) : null}
        </div>
        {spins.length === 0 ? (
          <p className="text-sm text-muted">{t('widgets.roulette.historyEmpty')}</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {spins.map((spin) => (
              <li
                key={spin.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 self-center rounded-[2px]"
                  style={{ backgroundColor: spin.color }}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{spin.label}</span>
                  <span className="block truncate text-xs text-muted">
                    {spin.username
                      ? `${spin.username}${spin.amount ? ` · ${formatMoney(spin.amount)}` : ''}`
                      : t('widgets.roulette.manual')}
                  </span>
                </span>
                <time className="text-xs text-muted tabular-nums" dateTime={spin.createdAt}>
                  {new Date(spin.createdAt).toLocaleTimeString(intlLocale(), {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

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
