import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    main: 'src/main.ts',
    preload: 'src/preload.ts',
  },
  format: 'cjs',
  clean: true,
  outExtension: () => ({ js: '.js' }),
  external: ['electron', 'electron-updater'],
  platform: 'node',
  bundle: true,
});
