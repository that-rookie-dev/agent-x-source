import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/workers/*.ts', 'src/tools/builtin/playwright-manager-child.ts'],
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
  // @napi-rs/canvas ships platform-specific native .node binaries — must stay
  // external so only the current platform's binary is loaded at runtime.
  // httpcloak's ESM wrapper uses createRequire(import.meta.url)./index.js,
  // which becomes a self-require cycle when bundled (see web-api startup error).
  external: ['pdfjs-dist', 'pdfjs-dist/build/pdf.mjs', 'pdfjs-dist/legacy/build/pdf.mjs', 'esbuild', '@napi-rs/canvas', 'httpcloak', 'playwright', '@homebridge/node-pty-prebuilt-multiarch'],
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});
