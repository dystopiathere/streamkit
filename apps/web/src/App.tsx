import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppLayout } from './components/AppLayout';
import { CookieBanner } from './components/CookieBanner';
import { SiteStats } from './features/public/SiteStats';
import { api } from './lib/api';
import { useAuthStore } from './lib/auth-store';
import { queryClient } from './lib/query-client';
import { EventsPage } from './pages/EventsPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { BillingPage } from './pages/BillingPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { RegisterPage } from './pages/RegisterPage';
import { RoomsPage } from './pages/RoomsPage';
import { SourcesPage } from './pages/SourcesPage';
import { WidgetEditorPage } from './pages/WidgetEditorPage';
import { WidgetsPage } from './pages/WidgetsPage';

/**
 * Аналитика грузится отдельным чанком.
 *
 * Только она тянет библиотеку графиков — а это больше трети всего бандла.
 * Стример, открывший дашборд ради ссылки для OBS, платить за неё загрузкой не
 * должен: это единственный маршрут, который открывают не каждый раз.
 */
const AnalyticsPage = lazy(async () => ({
  default: (await import('./pages/AnalyticsPage')).AnalyticsPage,
}));

/**
 * Комната стримера и страница гостя — тоже отдельными чанками, по той же
 * причине: клиент WebRTC весит больше, чем весь остальной дашборд, а нужен он
 * только тем, кто сейчас созванивается. Гость, открывший ссылку, при этом не
 * качает код дашборда сверх общего каркаса.
 */
const RoomPage = lazy(async () => ({
  default: (await import('./pages/RoomPage')).RoomPage,
}));
/**
 * Документы — отдельным чанком: рендер Markdown нужен только здесь, и
 * стример, открывший дашборд, за него не платит.
 */
const LegalPage = lazy(async () => ({
  default: (await import('./pages/LegalPage')).LegalPage,
}));
const JoinPage = lazy(async () => ({
  default: (await import('./pages/JoinPage')).JoinPage,
}));

function Loading(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <p role="status" className="p-8 text-muted">
      {t('common.loading')}
    </p>
  );
}

function Lazy({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

/**
 * Восстановление сессии.
 *
 * Access-токен живёт только в памяти, поэтому после перезагрузки страницы его
 * нет. Пока идёт обмен refresh-cookie на новый токен, нельзя ни показывать
 * дашборд, ни выкидывать на логин — иначе при каждом F5 будет мелькать форма
 * входа у вошедшего пользователя.
 */
function RequireAuth(): React.JSX.Element {
  const { accessToken, isRestoring } = useAuthStore();

  if (isRestoring) {
    return <Loading />;
  }

  return accessToken ? <Outlet /> : <Navigate to="/login" replace />;
}

export function App(): React.JSX.Element {
  useEffect(() => {
    void api.restoreSession().finally(() => {
      useAuthStore.getState().setRestoring(false);
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Главная открыта без входа: её проверяет ЮKassa перед подключением оплаты. */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/legal/:slug"
            element={
              <Lazy>
                <LegalPage />
              </Lazy>
            }
          />
          {/* Вне RequireAuth: гость не зарегистрирован, у него есть только ссылка. */}
          <Route
            path="/join"
            element={
              <Lazy>
                <JoinPage />
              </Lazy>
            }
          />

          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route path="/widgets" element={<WidgetsPage />} />
              <Route path="/widgets/:id" element={<WidgetEditorPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route
                path="/analytics"
                element={
                  <Suspense fallback={<Loading />}>
                    <AnalyticsPage />
                  </Suspense>
                }
              />
              <Route path="/rooms" element={<RoomsPage />} />
              <Route
                path="/rooms/:id"
                element={
                  <Lazy>
                    <RoomPage />
                  </Lazy>
                }
              />
              <Route path="/sources" element={<SourcesPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {/* Вне маршрутов: баннер нужен и публичным страницам, и дашборду, а
            статистика — только публичным, это решает сама SiteStats. */}
        <CookieBanner />
        <SiteStats />
      </BrowserRouter>

      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
