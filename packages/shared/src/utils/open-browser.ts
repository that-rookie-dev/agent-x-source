import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OPEN_SHIM_DIR_NAME = 'agentx-open-shim';
const OPENER_BASENAME = platform() === 'win32' ? 'agentx-open-url.cmd' : 'agentx-open-url';

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Open an HTTP(S) URL as a new tab in the user's existing Google Chrome
 * (macOS uses Privacy → Automation). Falls back to the system default opener.
 */
export async function openHttpUrlInExistingBrowser(url: string): Promise<void> {
  if (!isHttpUrl(url)) {
    throw new Error('Only http(s) URLs can be opened in the browser');
  }

  const os = platform();
  if (os === 'darwin') {
    const escaped = escapeAppleScriptString(url);
    const script = [
      'tell application "Google Chrome"',
      '  if it is running then',
      '    activate',
      '    if (count of windows) = 0 then make new window',
      `    tell window 1 to make new tab with properties {URL:"${escaped}"}`,
      '  else',
      `    open location "${escaped}"`,
      '    activate',
      '  end if',
      'end tell',
    ].join('\n');
    try {
      await execFileAsync('osascript', ['-e', script]);
      return;
    } catch {
      // Chrome missing or Automation denied — reuse Chrome process without -n/--new.
      try {
        await execFileAsync('open', ['-a', 'Google Chrome', url]);
        return;
      } catch {
        await execFileAsync('open', [url]);
        return;
      }
    }
  }

  if (os === 'win32') {
    // `start` reuses the default browser association (Chrome opens a tab when running).
    await execFileAsync('cmd', ['/c', 'start', '', url]);
    return;
  }

  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'xdg-open']) {
    try {
      await execFileAsync(bin, [url]);
      return;
    } catch {
      /* try next */
    }
  }
  throw new Error('No browser opener available');
}

/** Bash shim that replaces `open` for HTTP URLs (MCP clients on macOS). */
function darwinOpenShimScript(): string {
  return `#!/bin/bash
# Agent-X: open http(s) as a tab in existing Google Chrome (no new Chrome app).
set -e
REAL_OPEN="/usr/bin/open"
URL=""
PASS=()
APP_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--new)
      shift
      ;;
    -a)
      PASS+=("$1")
      shift
      if [[ $# -gt 0 ]]; then
        APP_NAME="$1"
        PASS+=("$1")
        shift
      fi
      ;;
    http://*|https://*)
      URL="$1"
      shift
      ;;
    *)
      PASS+=("$1")
      shift
      ;;
  esac
done

is_chrome_app() {
  local name
  name="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$name" in
    "google chrome"|"google chrome.app"|"chrome") return 0 ;;
    *) return 1 ;;
  esac
}

open_chrome_tab() {
  local target="$1"
  TMP_SCRIPT="$(mktemp -t agentx-chrome-tab)"
  trap 'rm -f "$TMP_SCRIPT"' EXIT
  {
    echo 'tell application "Google Chrome"'
    echo '  if it is running then'
    echo '    activate'
    echo '    if (count of windows) = 0 then make new window'
    printf '    tell window 1 to make new tab with properties {URL:"%s"}\\n' "$(printf '%s' "$target" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')"
    echo '  else'
    printf '    open location "%s"\\n' "$(printf '%s' "$target" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')"
    echo '    activate'
    echo '  end if'
    echo 'end tell'
  } > "$TMP_SCRIPT"
  if osascript "$TMP_SCRIPT" 2>/dev/null; then
    exit 0
  fi
  exec "$REAL_OPEN" -a "Google Chrome" "$target" || exec "$REAL_OPEN" "$target"
}

# Bare URL, or open -a "Google Chrome" <url> — both become a tab in the running Chrome.
if [[ -n "$URL" ]]; then
  if [[ -z "$APP_NAME" ]] || is_chrome_app "$APP_NAME"; then
    open_chrome_tab "$URL"
  fi
  exec "$REAL_OPEN" "\${PASS[@]}" "$URL"
fi

exec "$REAL_OPEN" "\${PASS[@]}"
`;
}

/** Dedicated URL opener used as BROWSER= for Python/Node MCP clients. */
function darwinAgentxOpenUrlScript(): string {
  return `#!/bin/bash
# Agent-X BROWSER opener: HTTP(S) → existing Google Chrome tab.
set -e
URL="\${1:-}"
if [[ -z "$URL" ]]; then
  exit 1
fi
case "$URL" in
  http://*|https://*) ;;
  *) exec /usr/bin/open "$URL" ;;
esac
TMP_SCRIPT="$(mktemp -t agentx-chrome-tab)"
trap 'rm -f "$TMP_SCRIPT"' EXIT
{
  echo 'tell application "Google Chrome"'
  echo '  if it is running then'
  echo '    activate'
  echo '    if (count of windows) = 0 then make new window'
  printf '    tell window 1 to make new tab with properties {URL:"%s"}\\n' "$(printf '%s' "$URL" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')"
  echo '  else'
  printf '    open location "%s"\\n' "$(printf '%s' "$URL" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')"
  echo '    activate'
  echo '  end if'
  echo 'end tell'
} > "$TMP_SCRIPT"
if osascript "$TMP_SCRIPT" 2>/dev/null; then
  exit 0
fi
exec /usr/bin/open -a "Google Chrome" "$URL" || exec /usr/bin/open "$URL"
`;
}

function linuxXdgOpenShimScript(): string {
  return `#!/bin/bash
# Agent-X: prefer existing Chrome/Chromium for http(s) URLs.
set -e
URL=""
PASS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    http://*|https://*)
      URL="$1"
      shift
      ;;
    *)
      PASS+=("$1")
      shift
      ;;
  esac
done

REAL_XDG=""
for candidate in /usr/bin/xdg-open /bin/xdg-open; do
  if [[ -x "$candidate" && "$candidate" != "$0" ]]; then
    REAL_XDG="$candidate"
    break
  fi
done

if [[ -n "$URL" ]]; then
  for bin in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$bin" >/dev/null 2>&1; then
      exec "$bin" "$URL"
    fi
  done
fi

if [[ -n "$REAL_XDG" ]]; then
  if [[ -n "$URL" ]]; then
    exec "$REAL_XDG" "\${PASS[@]}" "$URL"
  fi
  exec "$REAL_XDG" "\${PASS[@]}"
fi
exit 127
`;
}

function linuxAgentxOpenUrlScript(): string {
  return `#!/bin/bash
set -e
URL="\${1:-}"
[[ -n "$URL" ]] || exit 1
for bin in google-chrome google-chrome-stable chromium chromium-browser xdg-open; do
  if command -v "$bin" >/dev/null 2>&1; then
    exec "$bin" "$URL"
  fi
done
exit 127
`;
}

function windowsAgentxOpenUrlScript(): string {
  return `@echo off
REM Agent-X BROWSER opener: reuse default browser tab when possible.
if "%~1"=="" exit /b 1
start "" "%~1"
`;
}

function shimCandidateDirs(baseDir?: string): string[] {
  return [
    baseDir ? join(baseDir, OPEN_SHIM_DIR_NAME) : null,
    join(homedir(), '.local', 'share', 'agentx', OPEN_SHIM_DIR_NAME),
    join(tmpdir(), OPEN_SHIM_DIR_NAME),
  ].filter((value): value is string => Boolean(value));
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents, 'utf-8');
  if (platform() !== 'win32') {
    chmodSync(path, 0o755);
  }
}

/**
 * Ensure PATH-prefixed browser shims exist so MCP stdio servers that shell out
 * to `open` / `xdg-open` (or honor `BROWSER`) reuse the existing Chrome tab.
 * Returns the directory to prepend to PATH, or null if shims could not be created.
 */
export function ensureOpenBrowserShimDir(baseDir?: string): string | null {
  const os = platform();
  for (const shimDir of shimCandidateDirs(baseDir)) {
    try {
      mkdirSync(shimDir, { recursive: true });

      if (os === 'darwin') {
        writeExecutable(join(shimDir, 'open'), darwinOpenShimScript());
        writeExecutable(join(shimDir, OPENER_BASENAME), darwinAgentxOpenUrlScript());
      } else if (os === 'linux') {
        writeExecutable(join(shimDir, 'xdg-open'), linuxXdgOpenShimScript());
        writeExecutable(join(shimDir, OPENER_BASENAME), linuxAgentxOpenUrlScript());
      } else if (os === 'win32') {
        writeExecutable(join(shimDir, OPENER_BASENAME), windowsAgentxOpenUrlScript());
      } else {
        return null;
      }

      if (existsSync(join(shimDir, OPENER_BASENAME))) return shimDir;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Apply browser-launch env so every MCP stdio child reuses an existing Chrome tab
 * for auth / OAuth URL opens (PATH shim + BROWSER).
 */
export function applyMcpBrowserLaunchEnv(
  env: Record<string, string>,
  baseDir?: string,
): Record<string, string> {
  const shimDir = ensureOpenBrowserShimDir(baseDir);
  if (!shimDir) return env;

  const current = env.PATH ?? env.Path ?? '';
  const pathWithShim = current.startsWith(`${shimDir}${delimiter}`) || current === shimDir
    ? current
    : `${shimDir}${delimiter}${current}`;
  env.PATH = pathWithShim;
  if (platform() === 'win32') {
    env.Path = pathWithShim;
  }

  const opener = join(shimDir, OPENER_BASENAME);
  // Force our opener even if a provider env tried to set BROWSER.
  env.BROWSER = opener;
  env.AGENTX_BROWSER_OPENER = opener;
  return env;
}
