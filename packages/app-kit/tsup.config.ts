import { defineConfig } from 'tsup';

export default defineConfig({
  // График — отдельный вход: иначе recharts, импортированный из главного
  // входа, попадал в основной бандл приложения, даже если графики есть только
  // на лениво загружаемой странице.
  entry: ['src/index.ts', 'src/chart.tsx'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Всё, что держит собственное состояние (контекст роутера, экземпляр i18next),
  // обязано быть одним экземпляром с приложением: копия внутри пакета не видела
  // бы ни маршрута, ни переводов.
  external: ['react', 'react-dom', 'react-router-dom', 'react-i18next', 'recharts', 'lucide-react'],
});
