import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AdminLayout } from './components/AdminLayout';
import { api } from './lib/api';
import { useAuthStore } from './lib/auth-store';
import { queryClient } from './lib/query-client';
import { AuditPage } from './pages/AuditPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { LoginPage } from './pages/LoginPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { RoomsPage } from './pages/RoomsPage';
import { UserPage } from './pages/UserPage';
import { UsersPage } from './pages/UsersPage';
import { WidgetsPage } from './pages/WidgetsPage';

/** Обзор тянет библиотеку графиков — отдельным чанком, как аналитика в дашборде. */
const OverviewPage = lazy(async () => ({
  default: (await import('./pages/OverviewPage')).OverviewPage,
}));

function Loading(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <p role="status" className="p-8 text-muted">
      {t('common.loading')}
    </p>
  );
}

function RequireStaff(): React.JSX.Element {
  const { accessToken, isRestoring } = useAuthStore();
  if (isRestoring) return <Loading />;
  return accessToken ? <Outlet /> : <Navigate to="/login" replace />;
}

/** Журнал — только админу: поддержке маршрут не показывается и не открывается. */
function RequireAdmin(): React.JSX.Element {
  const staff = useAuthStore((state) => state.staff);
  return staff?.role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
}

export function App(): React.JSX.Element {
  const setRestoring = useAuthStore((state) => state.setRestoring);

  useEffect(() => {
    void api.restoreSession().finally(() => setRestoring(false));
  }, [setRestoring]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireStaff />}>
            <Route element={<AdminLayout />}>
              <Route
                index
                element={
                  <Suspense fallback={<Loading />}>
                    <OverviewPage />
                  </Suspense>
                }
              />
              <Route path="users" element={<UsersPage />} />
              <Route path="users/:id" element={<UserPage />} />
              <Route path="widgets" element={<WidgetsPage />} />
              <Route path="rooms" element={<RoomsPage />} />
              <Route path="channels" element={<ChannelsPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route element={<RequireAdmin />}>
                <Route path="audit" element={<AuditPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
