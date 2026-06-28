import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/neuron/',
  server: {
    port: 3334,
    strictPort: true,
  },
  preview: {
    port: 3334,
    strictPort: true,
  },
});
