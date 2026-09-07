import { normalize, resolve } from 'node:path';

const SAFE_SHELL_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'TMPDIR', 'TMP', 'TEMP', 'PWD', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'PATHEXT', 'NODE_ENV', 'AGENTX_FILES_DIR',
]);

const DOWNLOAD_TOOLS = new Set(['curl', 'wget', 'aria2c', 'aria2', 'axel', 'wget2', 'lftp', 'sftp', 'scp', 'rsync', 'rclone', 'yt-dlp', 'you-get', 'ffmpeg', 'ffprobe']);
const DOWNLOAD_EXTENSIONS = /\.(litertlm|tflite|gguf|safetensors|onnx|pt|pth|bin|data|arrow|parquet|npy|npz|ckpt|pb|h5|hdf5|pkl|pickle|zip|tar\.gz|tar\.bz2|tar\.xz|tar\.lz|tgz|tbz|txz|7z|rar|jar|war|ear|so|dylib|dll|exe|apk|ipa|dmg|pkg|deb|rpm|whl|iso|img|vmdk|qcow2|ova|ovf|tar|gz|bz2|xz|lz4|zst|br|lz|lzma|kmz|blend|psd|ai|indd|sketch|fig|xd|dwg|dxf|gcode|stl|obj|fbx|glb|gltf|usdz|mp3|mp4|m4a|aac|ogg|opus|flac|wav|wma|aiff|au|avi|mkv|mov|wmv|flv|webm|m4v|3gp|ts|m2ts|ogv|mpg|mpeg|webp|png|jpg|jpeg|gif|bmp|tiff|tif|svg|ico|heic|heif|raw|cr2|nef|orf|sr2|dng|x3f|pef|arw|raw|rwl|rw2|pdf|epub|mobi|azw|azw3|djvu|cbz|cbr|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|tex|csv|tsv|jsonl|ndjson|msgpack|avro|orc|feather|mat|sas7bdat|sav|dta|rdata|rds|fdb|litedb|sqlite|db|mdb|accdb|sqlite3|duckdb|wal|shm)(?:[?#]|$)/i;

const URL_PATTERN = /(?:^|[\s'"(])(([a-z][a-z0-9+.-]*):\/\/[^\s;'"|&<>]+)/i;

export interface DownloadBlockResult {
  blocked: boolean;
  reason?: string;
}

export function buildShellEnv(scopePath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TERM: 'dumb', PWD: scopePath };
  for (const key of SAFE_SHELL_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

function resolveTokenPath(raw: string, cwd: string): string {
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

    const resolved = resolveTokenPath(raw, workDir);
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

const DOWNLOAD_OUTPUT_FLAG = /(?:^|\s)(?:-[oO]|--output(?:-document)?|--remote-name(?:-all)?|-P|--directory-prefix)(?:\s|=|$)/i;
const SHELL_REDIRECT = /(?:^|\s)(?:\d?>>?>?|>|<)\s*[^\s;|&`$()]+/;
const HEAD_FLAG = /(?:^|\s)(?:-[iI]|--head)(?:\s|$)/;
const VERSION_HELP_FLAG = /(?:^|\s)(?:--version|--help|-[vV]\b|-h\b)(?=\s|$)/;

function urlHostIsLocalhost(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function isBlockedDownloadCommand(command: string): DownloadBlockResult {
  const tokens = tokenizeShell(command);

  // Detect direct download utilities (curl/wget/aria2c/axel/etc.)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const base = token.replace(/^.*[\\/]/, '').toLowerCase();
    if (!DOWNLOAD_TOOLS.has(base)) continue;

    // Always allow version/help-only invocations.
    if (VERSION_HELP_FLAG.test(command) && !URL_PATTERN.test(command)) {
      continue;
    }

    // Reject HEAD-only curl probes on binary URLs? HEAD is a metadata probe, not
    // a body download, so allow it regardless of host.
    if (base === 'curl' && HEAD_FLAG.test(command) && !DOWNLOAD_OUTPUT_FLAG.test(command) && !SHELL_REDIRECT.test(command)) {
      continue;
    }

    // Find any URL in the command.
    const urlMatch = command.match(URL_PATTERN);
    if (!urlMatch) {
      // No URL present — e.g., running curl with no args or piped from stdin.
      continue;
    }

    const url = urlMatch[1]!;
    const hasOutputFlag = DOWNLOAD_OUTPUT_FLAG.test(command);
    const hasRedirect = SHELL_REDIRECT.test(command);
    const isBinaryExtension = DOWNLOAD_EXTENSIONS.test(url);

    // wget always saves; any wget with a URL is a download.
    if (base === 'wget') {
      return { blocked: true, reason: 'Use http_download for all file downloads. Do not use wget.' };
    }

    // aria2c/axel/lftp/yt-dlp/etc are download-only tools.
    if (!['curl', 'wget'].includes(base)) {
      return { blocked: true, reason: `Use http_download for all file downloads. Do not use ${base}.` };
    }

    // curl with a binary-looking file in the URL is almost certainly a download.
    if (isBinaryExtension) {
      return { blocked: true, reason: 'Use http_download for all file downloads. Do not use curl for binary files.' };
    }

    // curl with an output flag or shell redirect writes to disk.
    if (hasOutputFlag || hasRedirect) {
      return { blocked: true, reason: 'Use http_download for all file downloads. Do not use curl -o/-O/--output or shell redirects for downloads.' };
    }

    // Allow curl to local services for health checks (no output, no redirect,
    // and not a binary file).  Everything else should go through http_get/http_request.
    if (urlHostIsLocalhost(url)) {
      continue;
    }

    // External curl without output is a fetch, not a file download, but we still
    // prefer built-in HTTP tools and block curl for consistency.
    return { blocked: true, reason: 'Use http_get or http_request for HTTP probes and http_download for file downloads. Do not use curl.' };
  }

  // Detect inline script downloads (python/node/ruby/perl one-liners that fetch a URL and write).
  const scriptUrlMatch = command.match(URL_PATTERN);
  if (scriptUrlMatch && /\b(python3?|py|node|nodejs|bun|ruby|perl)\b/i.test(command)) {
    const fetchLibrary = /\b(urlretrieve|urlopen|requests\.(?:get|post)|httpx\.(?:get|post)|aiohttp|urllib\.request|http\.client|https?\.get|fetch|axios)\b/is.test(command);
    const binaryUrl = DOWNLOAD_EXTENSIONS.test(scriptUrlMatch[1]!);
    const writesFile = /\b(write|open\s*\(\s*['"][^'"]*['"][,\s]*['"][wb]|fs\.writeFile|createWriteStream|File\.open|IO\.write)\b/is.test(command);
    if ((fetchLibrary && binaryUrl) || (fetchLibrary && writesFile)) {
      return { blocked: true, reason: 'Use http_download for all file downloads. Do not use scripts to download files.' };
    }
  }

  // Detect git-lfs file downloads.
  if (/\bgit\s+lfs\s+(?:fetch|pull|smudge|checkout)\b/i.test(command)) {
    return { blocked: true, reason: 'Use http_download for file downloads. Do not use git lfs for direct file downloads.' };
  }

  return { blocked: false };
}
