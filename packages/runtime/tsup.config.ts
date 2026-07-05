import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs'],
  dts: true,
  clean: true,
  platform: 'node',
  bundle: true,
  external: ['pg', 'embedded-postgres', /^@embedded-postgres\//],
});
