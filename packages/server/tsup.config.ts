import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    daemon: 'src/daemon.ts',
    index: 'src/index.ts',
  },
  format: ['cjs'],
  clean: true,
  platform: 'node',
  bundle: true,
  external: ['pg', 'embedded-postgres', /^@embedded-postgres\//],
});
