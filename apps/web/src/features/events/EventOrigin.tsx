import {
  type AlertEvent,
  CHAT_PLATFORMS,
  type ChatPlatform,
  type EventProvider,
} from '@streamkit/contracts';
import { PLATFORM_TITLES, PlatformIcon } from '@streamkit/ui';
import { useTranslation } from 'react-i18next';
import { cn } from '@streamkit/app-kit';

/** Сервисы донатов называются так, как пишут себя сами, на любом языке одинаково. */
const SERVICE_TITLES: Partial<Record<EventProvider, string>> = {
  donationalerts: 'DonationAlerts',
  donatepay: 'DonatePay',
};

function isPlatform(provider: EventProvider): provider is ChatPlatform {
  return (CHAT_PLATFORMS as readonly string[]).includes(provider);
}

/**
 * Название источника события: площадка, сервис донатов или вебхук.
 *
 * @returns `null` для тестового алерта из кабинета — у него уже есть метка «тест»,
 *   и второе «из кабинета» рядом ничего не добавляет.
 */
export function useEventSourceTitle(provider: EventProvider): string | null {
  const { t } = useTranslation();
  if (isPlatform(provider)) return PLATFORM_TITLES[provider];
  if (provider === 'webhook') return t('events.source.webhook');
  if (provider === 'manual') return null;
  return SERVICE_TITLES[provider] ?? null;
}

/**
 * Что случилось и где: «Фолловер · Kick» со значком площадки.
 *
 * Строка ленты без этого — один ник и время: фолловер, рейд и подписка
 * неотличимы, а при нескольких площадках не видно, на какой из них.
 */
export function EventOrigin({
  event,
  className,
}: {
  event: Pick<AlertEvent, 'type' | 'provider'>;
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const source = useEventSourceTitle(event.provider);

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-muted', className)}>
      {isPlatform(event.provider) ? <PlatformIcon platform={event.provider} size={12} /> : null}
      <span className="truncate">
        {source
          ? t('events.origin', { type: t(`events.type.${event.type}`), source })
          : t(`events.type.${event.type}`)}
      </span>
    </span>
  );
}
