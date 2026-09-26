import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AccountLayout } from './components/AccountLayout';
import { AppLayout } from './components/AppLayout';
import { CookieBanner } from './components/CookieBanner';
import { SiteStats } from './features/public/SiteStats';
import { api } from './lib/api';
import { useAuthStore } from './lib/auth-store';
import { queryClient } from './lib/query-client';
import { usePageMeta } from './lib/seo';
import { EventsPage } from './pages/EventsPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { BillingPage } from './pages/BillingPage';
import { PlatformsPage } from './pages/PlatformsPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { RoomsPage } from './pages/RoomsPage';
import { SecurityPage } from './pages/SecurityPage';
import { SourcesPage } from './pages/SourcesPage';
import { StreamPage, StreamWindowPage } from './pages/StreamPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
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
const AnalyticsChartsPage = lazy(async () => ({
  default: (await import('./pages/AnalyticsChartsPage')).AnalyticsChartsPage,
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
/**
 * Переадресация со старого адреса раздела с сохранением строки запроса.
 *
 * `/billing`, `/privacy` и `/sources` переехали в профиль, но на них ведут
 * письма о продлении, уже лежащие в ящиках, возврат ЮKassa по платежам,
 * оформленным до выкатки, и закладки: `?payment=` обязан доехать до страницы
 * тарифа.
 */
function MovedTo({ to }: { to: string }): React.JSX.Element {
  const { search } = useLocation();
  return <Navigate to={{ pathname: to, search }} replace />;
}

function RequireAuth(): React.JSX.Element {
  const { accessToken, isRestoring } = useAuthStore();
  // Кабинет — вне выдачи. robots.txt закрывает его от обхода, а тег — на
  // случай, если адрес кабинета попадёт в поиск по внешней ссылке.
  usePageMeta({ noindex: true });

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
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Вне RequireAuth: ссылку из письма открывают и там, где не входили. */}
          <Route path="/verify-email" element={<VerifyEmailPage />} />
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
            {/* Окно эфира без меню: отдельное окно браузера или док OBS. */}
            <Route path="/stream/window" element={<StreamWindowPage />} />
            <Route element={<AppLayout />}>
              <Route path="/stream" element={<StreamPage />} />
              <Route path="/widgets" element={<WidgetsPage />} />
              <Route path="/widgets/:id" element={<WidgetEditorPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route
                path="/analytics"
                element={
                  <Lazy>
                    <AnalyticsPage />
                  </Lazy>
                }
              />
              <Route
                path="/analytics/charts"
                element={
                  <Lazy>
                    <AnalyticsChartsPage />
                  </Lazy>
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
              <Route path="/account" element={<AccountLayout />}>
                <Route index element={<Navigate to="platforms" replace />} />
                <Route path="platforms" element={<PlatformsPage />} />
                <Route path="sources" element={<SourcesPage />} />
                <Route path="security" element={<SecurityPage />} />
                <Route path="billing" element={<BillingPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
              </Route>
              <Route path="/sources" element={<MovedTo to="/account/sources" />} />
              <Route path="/billing" element={<MovedTo to="/account/billing" />} />
              <Route path="/privacy" element={<MovedTo to="/account/privacy" />} />
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
