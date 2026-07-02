import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/app/main/index.ts'),
          // The transcription worker is a separate utilityProcess entry point.
          worker: resolve(__dirname, 'src/adapters/transcription/worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/app/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: 'src/ui',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/ui/index.html') },
      },
    },
  },
});
