import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@shared': resolve(rootDir, 'src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      emptyOutDir: false,
    },
    resolve: {
      alias: {
        '@shared': resolve(rootDir, 'src/shared'),
      },
    },
  },
  renderer: {
    build: {
      outDir: 'dist/renderer',
      emptyOutDir: false,
    },
    resolve: {
      alias: {
        '@shared': resolve(rootDir, 'src/shared'),
      },
    },
  },
});