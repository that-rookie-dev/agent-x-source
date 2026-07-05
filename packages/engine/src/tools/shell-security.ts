import { normalize, resolve } from 'node:path';

const SAFE_SHELL_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'TMPDIR', 'TMP', 'TEMP', 'PWD', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'PATHEXT', 'NODE_ENV', 'AGENTX_FILES_DIR',
]);

/** Child PIDs spawned by Agent-X shell tools (background / streaming). */
const trackedChildPids = new Set<number>();

export function trackShellChildPid(pid: number | undefined): void {
  if (pid && pid > 0) trackedChildPids.add(pid);
}

export function isTrackedShellPid(pid: number): boolean {
  return trackedChildPids.has(pid);
}

export function untrackShellPid(pid: number): void {
  trackedChildPids.delete(pid);
}

export function buildShellEnv(scopePath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TERM: 'dumb', PWD: scopePath };
  for (const key of SAFE_SHELL_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

function resolveTokenPath(raw: string, scopePath: string, cwd: string): string {
  const cleaned = raw.replace(/[;,|&()]+$/, '');
  if (cleaned.startsWith('/')) return normalize(resolve('/', cleaned));
  if (/^[A-Z]:[\\/]/i.test(cleaned)) return normalize(resolve(cleaned));
  return normalize(resolve(cwd, cleaned));
}

export function validateCommandScope(command: string, scopePath: string, cwd?: string): string | null {
  const workDir = cwd ?? scopePath;
  const scopeNorm = normalize(scopePath);
  const tokens = tokenizeShell(command);

  for (const token of tokens) {
    const raw = token.replace(/[;,|&()]+$/, '');
    if (!raw || raw.startsWith('-')) continue;
    if (raw.startsWith('$') || raw.startsWith('{')) continue;
    if (/^\d+$/.test(raw)) continue;
    if (raw === '/dev/null' || raw === '/dev/zero' || raw.startsWith('/dev/fd/')) continue;
    if (raw.startsWith('/proc/')) continue;

    const looksLikePath =
      raw.includes('/') ||
      raw.includes('\\') ||
      raw.startsWith('.') ||
      raw === '..' ||
      /^[A-Z]:[\\/]/i.test(raw);

    if (!looksLikePath) continue;

    const resolved = resolveTokenPath(raw, scopeNorm, workDir);
    if (!resolved.startsWith(scopeNorm)) {
      return `Path "${raw}" resolves outside scope (${scopeNorm})`;
    }
  }
  return null;
}

export function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let inSingle = false;
  let inDouble = false;
  for (const c of command) {
    if (c === '\'' && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (inSingle || inDouble) { token += c; continue; }
    if (/\s/.test(c) || ';|&()'.includes(c)) {
      if (token) { tokens.push(token); token = ''; }
      continue;
    }
    token += c;
  }
  if (token) tokens.push(token);
  return tokens;
}
