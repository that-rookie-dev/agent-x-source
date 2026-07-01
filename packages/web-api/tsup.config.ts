import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sharpStubContents = readFileSync(resolve(__dirname, 'sharp-stub.js'), 'utf-8');

const sharpAliasPlugin = {
  name: 'sharp-alias',
  setup(build: any) {
    build.onResolve({ filter: /^sharp$/ }, (args: any) => ({
      path: resolve(__dirname, 'sharp-stub.js'),
      namespace: 'sharp-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'sharp-stub' }, (args: any) => ({
      contents: sharpStubContents,
      loader: 'js' as const,
    }));
  },
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  shims: false,
  clean: true,
  // Bundle everything into a single self-contained file so the release
  // tarball works without node_modules (matching CLI behaviour).
  // NOTE: ONNX runtime packages must stay external because they load native
  // .node binaries via relative paths inside the package. They are copied into
  // dist/node_modules by the post-build script.
  // NOTE: pdfjs-dist must stay external because it dynamically imports
  // pdf.worker.mjs via a relative path at runtime. Bundling it breaks that
  // import because the worker file is not emitted alongside the bundle.
  noExternal: [/^(?!onnxruntime-|pdfjs-dist).*$/],
  external: ['onnxruntime-node', 'onnxruntime-web', 'onnxruntime-common', 'pdfjs-dist'],
  banner: {
    js: "import { createRequire as __bannerCr } from 'module'; const require = __bannerCr(import.meta.url); import { fileURLToPath as __futp } from 'node:url'; import { dirname as __dn } from 'node:path'; const __filename = __futp(import.meta.url); const __dirname = __dn(__filename);",
  },
  esbuildPlugins: [sharpAliasPlugin],
});
