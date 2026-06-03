#!/usr/bin/env node

import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/webview/ui/main.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outfile: 'dist/webview/index.js',
  sourcemap: !production ? 'inline' : false,
  minify: production,
  treeShaking: true,
  jsx: 'automatic',
  loader: {
    '.svg': 'text',
    '.css': 'css',
  },
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  logLevel: 'info',
  plugins: watch
    ? [
        {
          name: 'watch-plugin',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length > 0) {
                console.error('[esbuild:webview] Build failed:', result.errors);
              } else {
                console.log('[esbuild:webview] Build succeeded, waiting for changes...');
              }
            });
          },
        },
      ]
    : [],
});

if (watch) {
  await ctx.watch();
  console.log('[esbuild:webview] Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
