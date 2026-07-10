import { describe, expect, it } from 'vitest';
import {
  buildEmbeddedPostgresChildEnv,
  envWithoutEmbeddedPostgresLibs,
  filterEmbeddedPostgresLibPath,
  isEmbeddedPostgresLibSegment,
} from '../src/utils/embedded-pg-env.js';

describe('embedded-pg-env isolation', () => {
  it('detects embedded-postgres lib path segments', () => {
    expect(isEmbeddedPostgresLibSegment('/app/node_modules/@embedded-postgres/darwin-arm64/native/lib')).toBe(true);
    expect(isEmbeddedPostgresLibSegment('C:\\app\\node_modules\\@embedded-postgres\\windows-x64\\native\\lib')).toBe(true);
    expect(isEmbeddedPostgresLibSegment('/usr/local/lib')).toBe(false);
  });

  it('filters only embedded-postgres entries from library paths', () => {
    const filtered = filterEmbeddedPostgresLibPath(
      '/usr/local/lib:/opt/agentx/node_modules/@embedded-postgres/linux-x64/native/lib:/opt/homebrew/lib',
      ':',
    );
    expect(filtered).toBe('/usr/local/lib:/opt/homebrew/lib');
    expect(filterEmbeddedPostgresLibPath('/x/@embedded-postgres/y', ':')).toBeUndefined();
  });

  it('strips poisoned DYLD/LD paths for ffmpeg-safe child env', () => {
    const env = envWithoutEmbeddedPostgresLibs({
      PATH: '/usr/bin',
      DYLD_LIBRARY_PATH: '/opt/homebrew/lib:/app/node_modules/@embedded-postgres/darwin-arm64/native/lib',
      LD_LIBRARY_PATH: '/app/node_modules/@embedded-postgres/linux-x64/native/lib',
      KEEP: '1',
    });
    expect(env.DYLD_LIBRARY_PATH).toBe('/opt/homebrew/lib');
    expect(env.LD_LIBRARY_PATH).toBeUndefined();
    expect(env.KEEP).toBe('1');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('builds darwin postgres child env with native libs first', () => {
    const binaryDir = '/install/node_modules/@embedded-postgres/darwin-arm64/native/bin';
    const lib = '/install/node_modules/@embedded-postgres/darwin-arm64/native/lib';
    const pgLib = `${lib}/postgresql`;
    const env = buildEmbeddedPostgresChildEnv({
      binaryDir,
      platform: 'darwin',
      baseEnv: {
        DYLD_LIBRARY_PATH: '/usr/local/lib',
        PATH: '/usr/bin',
      },
      pathExists: (p) => p === lib || p === pgLib || p === binaryDir,
    });
    expect(env.DYLD_LIBRARY_PATH).toBe(`${lib}:${pgLib}:/usr/local/lib`);
    expect(env.LC_MESSAGES).toBe('C');
    // Parent PATH untouched for unix — loader_path handles core dylibs.
    expect(env.PATH).toBe('/usr/bin');
  });

  it('builds linux postgres child env with LD_LIBRARY_PATH', () => {
    const binaryDir = '/install/node_modules/@embedded-postgres/linux-x64/native/bin';
    const lib = '/install/node_modules/@embedded-postgres/linux-x64/native/lib';
    const pgLib = `${lib}/postgresql`;
    const env = buildEmbeddedPostgresChildEnv({
      binaryDir,
      platform: 'linux',
      baseEnv: { LD_LIBRARY_PATH: '/usr/lib' },
      pathExists: (p) => p === lib || p === pgLib,
    });
    expect(env.LD_LIBRARY_PATH).toBe(`${lib}:${pgLib}:/usr/lib`);
    expect(env.DYLD_LIBRARY_PATH).toBeUndefined();
  });

  it('builds windows postgres child env with bin/lib on PATH for DLLs', () => {
    const binaryDir = 'C:\\install\\node_modules\\@embedded-postgres\\windows-x64\\native\\bin';
    const lib = 'C:\\install\\node_modules\\@embedded-postgres\\windows-x64\\native\\lib';
    const pgLib = 'C:\\install\\node_modules\\@embedded-postgres\\windows-x64\\native\\lib\\postgresql';
    const env = buildEmbeddedPostgresChildEnv({
      binaryDir,
      platform: 'win32',
      baseEnv: { PATH: 'C:\\Windows\\System32', Path: 'C:\\Windows\\System32' },
      pathExists: (p) => p === binaryDir || p === lib || p === pgLib,
    });
    expect(env.PATH).toBe(`${binaryDir};${lib};${pgLib};C:\\Windows\\System32`);
    expect(env.Path).toBe(env.PATH);
    expect(env.DYLD_LIBRARY_PATH).toBeUndefined();
    expect(env.LD_LIBRARY_PATH).toBeUndefined();
  });

  it('does not mutate the provided base env object', () => {
    const base = { DYLD_LIBRARY_PATH: '/poison/@embedded-postgres/lib', KEEP: 'yes' };
    const copy = { ...base };
    envWithoutEmbeddedPostgresLibs(base);
    expect(base).toEqual(copy);
  });
});
