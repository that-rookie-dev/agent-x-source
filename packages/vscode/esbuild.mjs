#!/usr/bin/env node

import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  external: [
    'vscode',
    'better-sqlite3',
    'node-pty',
    'playwright',
    'playwright-core',
  ],
  alias: {
    '@agentx/engine': '../engine/src/index.ts',
    '@agentx/shared': '../shared/src/index.ts',
  },
  logLevel: 'info',
  plugins: watch
    ? [
        {
          name: 'watch-plugin',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length > 0) {
                console.error('[esbuild] Build failed:', result.errors);
              } else {
                console.log('[esbuild] Build succeeded, waiting for changes...');
              }
            });
          },
        },
      ]
    : [],
});

if (watch) {
  await ctx.watch();
  console.log('[esbuild] Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
