import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Отдельное приложение, а не роут дашборда: страница открывается браузер-сорсом
// OBS, и всё, что не нужно для показа алерта, здесь лишний вес и лишний риск.
export default defineConfig({
  plugins: [react()],
  build: {
    // Sourcemap не нужен: страницу никто не отлаживает через devtools OBS,
    // а размер бандла важен — он грузится при каждом старте сцены.
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
