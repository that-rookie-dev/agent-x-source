import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/daemon.ts'],
  format: ['esm'],
  banner: {
    js: '#!/usr/bin/env node',
  },
  clean: true,
});
