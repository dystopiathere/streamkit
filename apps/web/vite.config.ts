import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { seoPlugin } from './vite/seo-plugin.ts';

export default defineConfig({
  // Адрес сайта — тот же, что берёт `src/lib/seo.ts`: canonical в снимке главной
  // и в живой странице обязаны совпадать.
  plugins: [
    react(),
    tailwindcss(),
    seoPlugin(process.env.VITE_SITE_URL ?? 'https://stream-kit.ru'),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // В разработке фронт и API живут на разных портах. Прокси делает их
      // одним origin, иначе httpOnly-cookie с refresh-токеном не поставится.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Статистика посещений: в проде Umami отдаёт Caddy по префиксу /u. Для
      // проверки счётчика в разработке — адрес локального Umami в UMAMI_DEV_URL.
      ...(process.env.UMAMI_DEV_URL
        ? {
            '/u': {
              target: process.env.UMAMI_DEV_URL,
              changeOrigin: true,
              rewrite: (path: string) => path.replace(/^\/u/, ''),
            },
          }
        : {}),
    },
  },
});
