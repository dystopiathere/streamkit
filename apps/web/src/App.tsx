import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppLayout } from './components/AppLayout';
import { api } from './lib/api';
import { useAuthStore } from './lib/auth-store';
import { EventsPage } from './pages/EventsPage';
import { LegalPage } from './pages/LegalPage';
import { LoginPage } from './pages/LoginPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { RegisterPage } from './pages/RegisterPage';
import { SourcesPage } from './pages/SourcesPage';
import { WidgetEditorPage } from './pages/WidgetEditorPage';
import { WidgetsPage } from './pages/WidgetsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Данные дашборда меняются не каждую секунду, а рефетч при каждом
      // переключении вкладки во время стрима — лишняя нагрузка и мигание.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

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
    return <div className="p-8 text-muted">Загрузка…</div>;
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
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/legal/:slug" element={<LegalPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route path="/widgets" element={<WidgetsPage />} />
              <Route path="/widgets/:id" element={<WidgetEditorPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/sources" element={<SourcesPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/widgets" replace />} />
        </Routes>
      </BrowserRouter>

      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
