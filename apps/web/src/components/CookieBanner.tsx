import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { isAnalyticsAccepted, useConsents, useGrantConsent } from '@/features/privacy/queries';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import {
  ANALYTICS_CONSENT,
  readCookieChoice,
  reconcileCookieChoice,
  useCookieChoice,
  visitorId,
  writeCookieChoice,
} from '@/lib/cookie-consent';
import { Button } from '@streamkit/app-kit';

/**
 * Баннер cookie с реальным выбором.
 *
 * Ключевое: статистика не загружается, пока человек не согласился — баннер не
 * «уведомление», а переключатель. Кнопка отказа стоит рядом с кнопкой согласия
 * и выглядит так же: скрытый или задизайненный «в никуда» отказ согласием не
 * считается.
 *
 * Согласие записывается в ЖУРНАЛ на сервере, а в браузере остаётся только его
 * копия. Журналов два: у вошедшего — его журнал согласий (виден в разделе
 * «Приватность»), у посетителя без учётной записи — журнал посетителей со
 * случайным идентификатором браузера. Главную, где и считается посещаемость,
 * смотрят в основном вторые.
 *
 * На странице гостя баннера нет: там статистики нет, а гостю, пришедшему на
 * созвон, вопрос о cookie только мешает.
 */
export function CookieBanner(): React.JSX.Element | null {
  const { pathname } = useLocation();
  const { accessToken, isRestoring } = useAuthStore();
  if (isRestoring || pathname.startsWith('/join')) return null;
  return accessToken ? <UserCookieBanner /> : <VisitorCookieBanner />;
}

function UserCookieBanner(): React.JSX.Element | null {
  const choice = useCookieChoice();
  const consents = useConsents();
  const grant = useGrantConsent();
  const { t } = useTranslation();

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

  // Пока журнал не загружен, спрашивать рано: ответ уже может быть записан.
  if (!loaded || choice !== null) return null;
  return (
    <BannerView
      onAccept={() => void acceptAll()}
      // «Только необходимые» в журнал ничего не пишет: отзывать нечего, пока
      // согласия нет, а лишняя запись отзыва засоряла бы аудит.
      onDecline={() => writeCookieChoice('necessary')}
      pending={grant.isPending}
    />
  );
}

function VisitorCookieBanner(): React.JSX.Element | null {
  const choice = useCookieChoice();
  const { t } = useTranslation();

  const acceptAll = async (): Promise<void> => {
    try {
      await api.post<void>('/public/site-stats/consent', { visitorId: visitorId() });
      writeCookieChoice('all');
    } catch {
      toast.error(t('common.error'));
    }
  };

  if (choice !== null) return null;
  return (
    <BannerView
      onAccept={() => void acceptAll()}
      onDecline={() => writeCookieChoice('necessary')}
      pending={false}
    />
  );
}

/**
 * Пересмотреть выбор: отозвать согласие посетителя, если оно было, и показать
 * баннер снова. Для вошедших то же делает раздел «Приватность».
 */
export async function resetVisitorCookieChoice(): Promise<void> {
  if (readCookieChoice() === 'all') {
    await api.post<void>('/public/site-stats/consent/revoke', { visitorId: visitorId() });
  }
  writeCookieChoice(null);
}

function BannerView({
  onAccept,
  onDecline,
  pending,
}: {
  onAccept: () => void;
  onDecline: () => void;
  pending: boolean;
}): React.JSX.Element {
  return (
    <>
      {/* Место под баннером в конце страницы. Без него закреплённый баннер
          закрывал подвал с офертой и реквизитами — ровно то, что модерация
          ЮKassa ищет на главной, — пока посетитель не ответит на вопрос. */}
      <div aria-hidden="true" className="h-36 sm:h-24" />
      <BannerPanel onAccept={onAccept} onDecline={onDecline} pending={pending} />
    </>
  );
}

function BannerPanel({
  onAccept,
  onDecline,
  pending,
}: {
  onAccept: () => void;
  onDecline: () => void;
  pending: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    // Не диалог: баннер не держит фокус и не мешает пользоваться страницей, а
    // отдельная область находится скринридером по списку ориентиров.
    <section
      aria-label={t('cookies.label')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface p-4"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {t('cookies.message')}{' '}
          <Link
            to="/legal/cookies"
            aria-label={t('cookies.moreAbout')}
            className="underline hover:text-fg"
          >
            {t('cookies.more')}
          </Link>
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" onClick={onDecline} disabled={pending}>
            {t('cookies.onlyNecessary')}
          </Button>
          <Button onClick={onAccept} isLoading={pending}>
            {t('cookies.acceptAll')}
          </Button>
        </div>
      </div>
    </section>
  );
}
