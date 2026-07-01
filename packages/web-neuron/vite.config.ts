import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: '/neuron/',
  resolve: {
    alias: {
      // gl-bench's "browser" field is a UMD bundle without an ESM default export,
      // which breaks Vite 8/rolldown's strict interop. Force-resolve to its ESM
      // module build so `import GLBench from "gl-bench"` works correctly.
      'gl-bench': fileURLToPath(new URL('./node_modules/gl-bench/dist/gl-bench.module.js', import.meta.url)),
    },
  },
  server: {
    port: 3334,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3333',
      '/ws': {
        target: 'ws://localhost:3333',
        ws: true,
      },
    },
  },
  preview: {
    port: 3334,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3333',
      '/ws': {
        target: 'ws://localhost:3333',
        ws: true,
      },
    },
  },
});
