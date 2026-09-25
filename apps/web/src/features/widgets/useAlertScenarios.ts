import { type AlertEventType, availableAlertScenarios, type Platform } from '@streamkit/contracts';
import { useMemo } from 'react';
import { useChannels } from '@/features/analytics/queries';

/** Какие сценарии оповещений показывать и какие площадки подключены. */
export interface AlertScenarioAvailability {
  /** Сценарии, которые подключённые площадки могут вызвать, в порядке типов. */
  scenarios: AlertEventType[];
  /** Подключённые площадки; пока список не пришёл — пусто. */
  platforms: Platform[];
}

/**
 * Сценарии по подключённым площадкам (`ALERT_SCENARIO_PLATFORMS`).
 *
 * Пока список каналов грузится, видны только сценарии без площадки: вкладки,
 * которые появляются, читаются спокойнее, чем вкладки, которые пропадают.
 */
export function useAlertScenarios(): AlertScenarioAvailability {
  const channels = useChannels();
  return useMemo(() => {
    const platforms = (channels.data ?? []).map((channel) => channel.platform);
    return { scenarios: availableAlertScenarios(platforms), platforms };
  }, [channels.data]);
}

/**
 * Сценарий, который показывать: выбранный, если он доступен, иначе донат —
 * он доступен всегда. Выбор не сбрасывается: площадку подключат, и стример
 * вернётся к тому сценарию, что выбирал.
 */
export function visibleScenario(
  selected: AlertEventType,
  available: readonly AlertEventType[],
): AlertEventType {
  return available.includes(selected) ? selected : 'donation';
}
