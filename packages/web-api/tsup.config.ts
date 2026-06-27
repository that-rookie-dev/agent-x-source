import { defineConfig } from 'tsup';

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
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});
