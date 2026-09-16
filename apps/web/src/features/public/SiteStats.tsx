import type { SiteStatsConfig } from '@streamkit/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '@/lib/api';
import { useCookieChoice } from '@/lib/cookie-consent';
import { isTrackedPath, loadSiteStats, setSiteStatsDisabled } from './site-stats';

/**
 * Статистика посещений публичных страниц.
 *
 * Ничего не грузит и не спрашивает у сервера, пока в баннере не нажато
 * «Принять все». После согласия берёт у API идентификатор сайта в Umami,
 * загружает счётчик и отправляет просмотр при каждом переходе на публичную
 * страницу. Отзыв согласия выключает уже загруженный счётчик.
 */
export function SiteStats(): null {
  const allowed = useCookieChoice() === 'all';
  const { pathname } = useLocation();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const config = useQuery({
    queryKey: ['public', 'site-stats'],
    queryFn: () => api.get<SiteStatsConfig>('/public/site-stats'),
    enabled: allowed,
    staleTime: 60 * 60 * 1000,
  });
  const websiteId = allowed ? (config.data?.umamiWebsiteId ?? null) : null;

  useEffect(() => {
    setSiteStatsDisabled(!allowed);
  }, [allowed]);

  useEffect(() => {
    if (!websiteId) return;
    let cancelled = false;
    loadSiteStats(websiteId)
      .then(() => {
        if (!cancelled) setLoadedFor(websiteId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [websiteId]);

  const ready = websiteId !== null && loadedFor === websiteId;
  useEffect(() => {
    if (ready && isTrackedPath(pathname)) window.umami?.track();
  }, [ready, pathname]);

  return null;
}
