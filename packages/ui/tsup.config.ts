import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  // В режиме наблюдения dist не очищается: `pnpm dev` запускает сборку пакетов
  // параллельно, и очищенные на старте типы `contracts` роняли сборку типов
  // соседнего пакета («Could not find a declaration file»).
  clean: !options.watch,
  external: ['react', 'react-dom'],
}));
