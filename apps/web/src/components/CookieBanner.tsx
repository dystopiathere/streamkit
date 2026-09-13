import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { isAnalyticsAccepted, useConsents, useGrantConsent } from '@/features/privacy/queries';
import {
  ANALYTICS_CONSENT,
  readCookieChoice,
  reconcileCookieChoice,
  useCookieChoice,
  writeCookieChoice,
} from '@/lib/cookie-consent';
import { Button } from './ui';

/**
 * Баннер cookie с реальным выбором.
 *
 * Ключевое: аналитика не инициализируется, пока пользователь не согласился —
 * баннер не «уведомление», а переключатель. Кнопка отказа стоит рядом с кнопкой
 * согласия и выглядит так же: скрытый или задизайненный «в никуда» отказ
 * согласием не считается.
 *
 * Согласие записывается в ЖУРНАЛ на сервере, а в браузере остаётся только его
 * копия. Раньше было наоборот: выбор жил в localStorage, в журнал не попадал, и
 * раздел «Приватность» показывал «Не принято» тому, кто нажал «Принять все».
 * Баннер смонтирован только в разделе для вошедших, поэтому пользователь, чьё
 * согласие записывать, при нажатии всегда известен.
 */
export function CookieBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const choice = useCookieChoice();
  const consents = useConsents();
  const grant = useGrantConsent();

  const serverAccepted = isAnalyticsAccepted(consents.data);
  const loaded = consents.data !== undefined;
  const serverUpdatedAt = consents.dataUpdatedAt;

  // Копия в браузере следует за журналом: он мог измениться в разделе
  // «Приватность» на другом устройстве, а запись из баннера — не дойти.
  //
  // Сверка срабатывает на НОВЫЙ ОТВЕТ СЕРВЕРА, а не на изменение копии, и
  // локальный выбор читается внутри, а не берётся зависимостью. Иначе гонка:
  // отзыв пишет в браузер «только необходимые», сверка тут же сравнивает это со
  // ещё не обновлённым ответом «принято», возвращает «Принять все», а свежий
  // ответ следом сбрасывает выбор — и баннер задаёт вопрос, на который только
  // что ответили.
  useEffect(() => {
    if (!loaded) return;
    const next = reconcileCookieChoice(readCookieChoice(), serverAccepted);
    if (next !== undefined) writeCookieChoice(next);
  }, [loaded, serverAccepted, serverUpdatedAt]);

  const acceptAll = async (): Promise<void> => {
    try {
      // Локальная копия пишется ПОСЛЕ записи в журнал, а не до: иначе сверка
      // увидела бы «принято в браузере, нет в журнале», сбросила выбор, и
      // баннер мигнул бы обратно.
      await grant.mutateAsync(ANALYTICS_CONSENT);
    } catch {
      toast.error(t('common.error'));
    }
  };

  // «Только необходимые» в журнал ничего не пишет: отзывать нечего, пока
  // согласия нет, а лишняя запись отзыва засоряла бы аудит.
  const onlyNecessary = (): void => writeCookieChoice('necessary');

  // Пока журнал не загружен, спрашивать рано: ответ уже может быть записан.
  if (!loaded || choice !== null) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {t('cookies.message')}{' '}
          <Link to="/legal/cookies" className="underline hover:text-fg">
            {t('cookies.more')}
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onlyNecessary} disabled={grant.isPending}>
            {t('cookies.onlyNecessary')}
          </Button>
          <Button onClick={() => void acceptAll()} isLoading={grant.isPending}>
            {t('cookies.acceptAll')}
          </Button>
        </div>
      </div>
    </div>
  );
}
