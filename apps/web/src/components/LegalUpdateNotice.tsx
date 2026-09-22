import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@streamkit/app-kit';
import { useAcknowledgeConsents, useConsents } from '@/features/privacy/queries';
import { useIsAuthenticated } from '@/lib/auth-store';

/** Какие редакции человек уже отложил в этом браузере. */
const DISMISSED_KEY = 'streamkit.legal-notice';

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) ?? '';
  } catch {
    // Приватное окно или запрещённые данные сайта: считаем, что не отложено.
    return '';
  }
}

function writeDismissed(value: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, value);
  } catch {
    // Не сохранилось — уведомление просто появится снова. Это не ошибка.
  }
}

/**
 * Уведомление о новой редакции документов.
 *
 * Зачем оно вообще. Согласие с правилами сервиса даётся регистрацией и
 * подтверждается наличием аккаунта: соглашение и оферта — договор, порядок их
 * изменения описан в самом соглашении, а политика конфиденциальности — не
 * согласие, а обязательная к публикации информация. Из этого следует, что
 * новая редакция вступает в силу сама, но уведомить о ней мы обязаны — иначе
 * человек связан условиями, которых не видел. До этого узнать об изменении
 * можно было только зайдя в раздел «Приватность».
 *
 * Уведомление ничего не блокирует. Услуга оказывается по договору, и отказ
 * нажать «Понятно» не повод выключать человеку сервис: «что будет, если не
 * принять» — ничего, кроме того, что баннер останется на месте, а в разделе
 * «Приватность» будет видно, какая редакция не отмечена.
 *
 * Исключение — документы-согласия по 152-ФЗ (`updatePolicy: 'reconsent'`):
 * молчание согласием не является, и у них текст просит подтвердить, а не
 * «ознакомиться». Блокировки и там нет.
 *
 * «Понятно» пишет отметку в журнал согласий: уведомление должно быть
 * доказуемым, а «баннер показывался» ничем не подтверждается. «Позже» —
 * только в этом браузере, и журнал об этом ничего не знает: иначе отложенное
 * на одной машине выглядело бы уведомлением на всех.
 */
export function LegalUpdateNotice(): React.JSX.Element | null {
  const { t } = useTranslation();
  const authenticated = useIsAuthenticated();
  const consents = useConsents(authenticated);
  const acknowledge = useAcknowledgeConsents();
  const [dismissed, setDismissed] = useState(() => readDismissed());

  const outdated = (consents.data ?? []).filter(
    (consent) => consent.needsRenewal && !consent.acceptedAtCheckout,
  );
  if (outdated.length === 0) return null;

  // Ключ — набор новых редакций: следующее изменение покажет баннер снова,
  // даже если предыдущее отложили.
  const key = outdated.map((consent) => `${consent.document}:${consent.currentVersion}`).join(' ');
  if (dismissed === key) return null;

  const needsConsent = outdated.some((consent) => consent.updatePolicy === 'reconsent');

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-border-strong bg-surface-hover px-4 py-3 text-sm"
    >
      <div className="min-w-0 space-y-1">
        <p>{needsConsent ? t('legalUpdate.reconsent') : t('legalUpdate.notify')}</p>
        <p className="text-muted">
          {outdated.map((consent) => consent.title).join(', ')}
          <span aria-hidden="true"> · </span>
          <Link to="/privacy" className="underline hover:text-fg">
            {t('legalUpdate.details')}
          </Link>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          isLoading={acknowledge.isPending}
          onClick={() =>
            acknowledge.mutate(undefined, {
              onError: () => toast.error(t('common.error')),
            })
          }
        >
          {needsConsent ? t('legalUpdate.confirm') : t('legalUpdate.gotIt')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            writeDismissed(key);
            setDismissed(key);
          }}
        >
          {t('legalUpdate.later')}
        </Button>
      </div>
    </div>
  );
}
