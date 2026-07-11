import { existsSync } from 'node:fs';
import path from 'node:path';
import { platform as hostPlatform } from 'node:os';

const EMBEDDED_PG_LIB_MARKERS = ['@embedded-postgres', 'embedded-postgres'];
/** DYLD_LIBRARY_PATH / LD_LIBRARY_PATH always use ':' even on Windows hosts. */
const UNIX_LIB_PATH_DELIMITER = ':';

function pathApiFor(plat: NodeJS.Platform): typeof path.posix {
  return plat === 'win32' ? path.win32 : path.posix;
}

/** True when a DYLD/LD/PATH segment points at bundled embedded-postgres libs. */
export function isEmbeddedPostgresLibSegment(segment: string): boolean {
  const value = segment.trim();
  if (!value) return false;
  return EMBEDDED_PG_LIB_MARKERS.some((marker) => value.includes(marker));
}

/**
 * Remove embedded-postgres entries from a delimited library/PATH string.
 * Returns undefined when nothing remains (caller should delete the env var).
 */
export function filterEmbeddedPostgresLibPath(
  value: string,
  sep: string = path.delimiter,
): string | undefined {
  const filtered = value
    .split(sep)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !isEmbeddedPostgresLibSegment(segment));
  return filtered.length > 0 ? filtered.join(sep) : undefined;
}

/**
 * Env for non-postgres children (ffmpeg, python, voice tools).
 * Strips process-wide embedded-postgres lib paths that break ffmpeg via libiconv.
 */
export function envWithoutEmbeddedPostgresLibs(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of ['DYLD_LIBRARY_PATH', 'LD_LIBRARY_PATH'] as const) {
    const value = env[key];
    if (!value) continue;
    const filtered = filterEmbeddedPostgresLibPath(value, UNIX_LIB_PATH_DELIMITER);
    if (filtered) env[key] = filtered;
    else delete env[key];
  }
  return env;
}

export interface EmbeddedPostgresChildEnvOptions {
  /** Directory containing postgres/initdb binaries (…/native/bin). */
  binaryDir: string;
  baseEnv?: NodeJS.ProcessEnv;
  /** Override platform for tests. */
  platform?: NodeJS.Platform;
  /** Override existsSync for tests. */
  pathExists?: (path: string) => boolean;
}

/**
 * Env for embedded-postgres children only (initdb / postgres).
 *
 * - darwin/linux: set DYLD/LD_LIBRARY_PATH to native/lib (+ postgresql/) first
 * - win32: prepend native/bin (+ lib dirs) to PATH for colocated DLLs/extensions
 * - never mutate the parent process env
 *
 * macOS/Linux binaries also use @loader_path/$ORIGIN, but scoped lib paths remain
 * required for extensions (AGE/pgvector) and as a reliable fallback.
 */
export function buildEmbeddedPostgresChildEnv(
  options: EmbeddedPostgresChildEnvOptions,
): NodeJS.ProcessEnv {
  const plat = options.platform ?? hostPlatform();
  const pathExists = options.pathExists ?? existsSync;
  const pathApi = pathApiFor(plat);
  const env: NodeJS.ProcessEnv = { ...(options.baseEnv ?? process.env), LC_MESSAGES: 'C' };

  const nativeRoot = pathApi.join(options.binaryDir, '..');
  const libDirs = [
    pathApi.join(nativeRoot, 'lib'),
    pathApi.join(nativeRoot, 'lib', 'postgresql'),
  ].filter((dir) => pathExists(dir));

  if (plat === 'win32') {
    const pathDirs = [options.binaryDir, ...libDirs].filter((dir) => pathExists(dir));
    if (pathDirs.length === 0) return env;
    const prefix = pathDirs.join(';');
    const existing = env.PATH || env.Path || '';
    env.PATH = existing ? `${prefix};${existing}` : prefix;
    env.Path = env.PATH;
    return env;
  }

  if (plat !== 'linux' && plat !== 'darwin') return env;
  if (libDirs.length === 0) return env;

  const libPathKey = plat === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  const inherited = (env[libPathKey] || '')
    .split(UNIX_LIB_PATH_DELIMITER)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !libDirs.includes(segment));

  // Postgres libs first so the server never picks up a conflicting system dylib.
  env[libPathKey] = [...libDirs, ...inherited].join(UNIX_LIB_PATH_DELIMITER);
  return env;
}
