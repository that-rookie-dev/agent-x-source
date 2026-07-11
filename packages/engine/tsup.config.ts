import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  splitting: true,
  dts: true,
  clean: true,
  // pdfjs-dist dynamically imports pdf.worker.mjs via a relative path at
  // runtime. Bundling it breaks that import because the worker file is not
  // emitted alongside the bundle. Keep it external so the runtime import
  // resolves from node_modules (or dist/node_modules in bundled apps).
  external: ['pdfjs-dist', 'pdfjs-dist/legacy/build/pdf.mjs', 'esbuild'],
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});
