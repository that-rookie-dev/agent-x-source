import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/daemon.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  clean: true,
  noExternal: [/^(?!better-sqlite3).*/],
  external: ['better-sqlite3'],
  esbuildPlugins: [
    {
      name: 'stub-optional',
      setup(build) {
        // Stub react-devtools-core (optional dep of ink, not needed at runtime)
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: 'react-devtools-core',
          namespace: 'stub',
        }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default undefined;',
          loader: 'js',
        }));
      },
    },
  ],
});
