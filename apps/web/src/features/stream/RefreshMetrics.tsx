import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@streamkit/app-kit';
import { intlLocale } from '@/lib/locale';
import { useRefreshStream } from './queries';

/**
 * Кнопка «Обновить» и время последнего снимка.
 *
 * Зачем она вообще нужна. Расписание опроса не может быть частым: вне эфира
 * канал опрашивается раз в пятнадцать минут, и это упирается не в лень, а в
 * суточную квоту YouTube — она выдаётся на весь проект, а не на пользователя.
 * О начале эфира Twitch и Kick сообщают событием сразу, у YouTube такого события нет,
 * и без кнопки окно узнавало бы о трансляции с опозданием до четверти часа.
 *
 * Пауза после нажатия — из контракта: её знают оба конца, сервер откажет
 * раньше срока, а кнопка до тех пор показывает отсчёт вместо подписи. Отсчёт
 * живёт в состоянии и двигается таймером: `Date.now()` в теле компонента
 * сделал бы рендер нечистым (грабли в CLAUDE.md).
 */
export function RefreshMetrics({ capturedAt }: { capturedAt: string | null }): React.JSX.Element {
  const { t } = useTranslation();
  const refresh = useRefreshStream();
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (readyAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [readyAt]);

  const waitSeconds = readyAt === null ? 0 : Math.ceil((readyAt - now) / 1000);
  const waiting = waitSeconds > 0;

  const onClick = (): void => {
    refresh.mutate(undefined, {
      onSuccess: (result) => {
        setNow(Date.now());
        setReadyAt(Date.parse(result.nextRefreshAt));
        // «Слишком часто» — не ошибка: данные в ответе всё равно свежие, просто
        // без нового запроса к площадке. Красное сообщение сказало бы неправду.
        if (result.throttled) toast.message(t('stream.refreshThrottled'));
      },
      onError: () => toast.error(t('common.error')),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        variant="secondary"
        isLoading={refresh.isPending}
        disabled={waiting}
        onClick={onClick}
        title={t('stream.refreshHint')}
      >
        {waiting ? t('stream.refreshIn', { seconds: waitSeconds }) : t('stream.refresh')}
      </Button>
      <p className="text-xs text-muted">
        {capturedAt
          ? t('stream.updatedAt', {
              time: new Date(capturedAt).toLocaleTimeString(intlLocale(), {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })
          : t('stream.neverUpdated')}
      </p>
    </div>
  );
}

/** Самый свежий снимок среди каналов — им подписан момент последнего опроса. */
export function latestCapturedAt(channels: { capturedAt: string | null }[]): string | null {
  let latest: string | null = null;
  for (const channel of channels) {
    if (!channel.capturedAt) continue;
    if (latest === null || Date.parse(channel.capturedAt) > Date.parse(latest)) {
      latest = channel.capturedAt;
    }
  }
  return latest;
}
