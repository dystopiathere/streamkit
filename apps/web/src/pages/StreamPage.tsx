import { useTranslation } from 'react-i18next';
import { Button, MainContent, SkipLink, usePageTitle } from '@streamkit/app-kit';
import { StreamView } from '@/features/stream/StreamView';

/** Адрес окна без меню — тот же, что вписывают в OBS док-панелью. */
const WINDOW_PATH = '/stream/window';

/** Окно эфира в дашборде. */
export function StreamPage(): React.JSX.Element {
  const { t } = useTranslation();
  usePageTitle(t('stream.title'));

  const openWindow = (): void => {
    // Имя окна — чтобы повторное нажатие не плодило окна, а поднимало открытое.
    window.open(WINDOW_PATH, 'streamkit-stream', 'popup,width=480,height=900');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('stream.title')}</h1>
        <Button variant="secondary" onClick={openWindow}>
          {t('stream.openWindow')}
        </Button>
      </div>
      <StreamView />
      <p className="text-xs text-muted">
        {t('stream.obsDock', { url: `${window.location.origin}${WINDOW_PATH}` })}
      </p>
    </div>
  );
}

/**
 * То же окно без меню дашборда: отдельное окно браузера рядом с игрой или
 * док-панель OBS. Узкое, поэтому колонки идут друг под другом.
 */
export function StreamWindowPage(): React.JSX.Element {
  const { t } = useTranslation();
  usePageTitle(t('stream.title'));

  return (
    <div className="min-h-dvh">
      <SkipLink />
      <MainContent className="mx-auto max-w-3xl p-3">
        <h1 className="sr-only">{t('stream.title')}</h1>
        <StreamView compact />
      </MainContent>
    </div>
  );
}
