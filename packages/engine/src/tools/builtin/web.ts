import type { ToolResult, ToolExecutionContext, DownloadProgress, DownloadResult } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { mkdirSync, createWriteStream, statSync, renameSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { markdownSourceLink, prefixWebExtractOutput, assertSafeFetchUrl } from '../../search/url-utils.js';
import { checkPlaywright, runPlaywright } from './browser.js';

function blockedUrlResult(url: string): ToolResult {
  return { success: false, output: `URL blocked by SSRF policy: ${url}`, error: 'SSRF_BLOCKED' };
}

function guardFetchUrl(url: string): ToolResult | null {
  try {
    assertSafeFetchUrl(url);
    return null;
  } catch {
    return blockedUrlResult(url);
  }
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;

/**
 * Wrapper around global `fetch` that manually follows HTTP 3xx redirects.
 *
 * The Agent-X keep-alive agent (`configureHttpKeepAlive`) replaces `globalThis.fetch`
 * with a custom implementation that does NOT follow redirects, so tools that call
 * `fetch` directly will see 302/307 responses and fail. This helper follows up to
 * `MAX_REDIRECTS` redirects and returns the final response.
 */
async function fetchWithRedirects(input: string | URL | Request, init?: RequestInit, maxRedirects = MAX_REDIRECTS): Promise<Response> {
  let currentInput = input;
  let currentInit = init ? { ...init } : undefined;
  let redirects = 0;

  while (true) {
    if (redirects++ > maxRedirects) {
      throw new Error(`Too many redirects (max ${maxRedirects})`);
    }

    const response = await fetch(currentInput, currentInit as RequestInit);

    if (REDIRECT_CODES.has(response.status)) {
      const location = response.headers.get('location') ?? response.headers.get('Location');
      if (!location) return response;

      // Discard the redirect body to free the underlying socket.
      await response.body?.cancel?.().catch(() => {});

      const base = typeof currentInput === 'string'
        ? currentInput
        : currentInput instanceof URL
          ? currentInput.href
          : currentInput.url;
      const nextUrl = new URL(location, base);

      const method = currentInit?.method?.toUpperCase() ?? 'GET';
      const status = response.status;
      const followMethod = status === 307 || status === 308
        ? method
        : 'GET';

      if (currentInit) {
        currentInit.method = followMethod;
        if (followMethod === 'GET') {
          currentInit.body = undefined;
        }

        // Security: do not forward Authorization/Cookie to a different host.
        const currentHost = typeof currentInput === 'string' ? new URL(currentInput).host : currentInput instanceof URL ? currentInput.host : new URL(currentInput.url).host;
        if (nextUrl.host !== currentHost) {
          const headers: Record<string, string> = {};
          const raw = currentInit.headers as Record<string, string> | undefined ?? {};
          for (const [key, value] of Object.entries(raw)) {
            const lower = key.toLowerCase();
            if (lower === 'authorization' || lower === 'cookie') continue;
            headers[key] = value;
          }
          currentInit.headers = headers;
        }
      }

      currentInput = nextUrl;
      continue;
    }

    return response;
  }
}

const BINARY_FILE_EXTENSIONS = /\.(?:litertlm|tflite|gguf|safetensors|onnx|pt|pth|bin|data|arrow|parquet|npy|npz|ckpt|pb|h5|hdf5|pkl|pickle|zip|tar\.gz|tar\.bz2|tar\.xz|tgz|tbz|txz|7z|rar|jar|war|ear|so|dylib|dll|exe|apk|ipa|dmg|pkg|deb|rpm|whl|iso|img|vmdk|qcow2|ova|ovf|tar|gz|bz2|xz|lz4|zst|br|lz|lzma|webp|png|jpg|jpeg|gif|bmp|tiff|tif|svg|ico|heic|heif|raw|cr2|nef|pdf|epub|mobi|mp3|mp4|m4a|aac|ogg|opus|flac|wav|avi|mkv|mov|wmv|flv|webm|m4v|3gp|mpg|mpeg|jsonl|ndjson|msgpack|avro|orc|feather|mat|sas7bdat|sav|dta|rdata|rds|fdb|litedb|sqlite|db|mdb|accdb|sqlite3|duckdb|wal|shm)(?:[?#]|$)/i;

function isTextContentType(contentType: string): boolean {
  const t = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (t.startsWith('text/')) return true;
  if (t.startsWith('application/json') || t.endsWith('+json')) return true;
  if (t.startsWith('application/xml') || t.endsWith('+xml')) return true;
  if (t.startsWith('application/xhtml')) return true;
  if (t.startsWith('application/javascript') || t.startsWith('application/x-javascript') || t.startsWith('application/typescript') || t.startsWith('application/x-typescript')) return true;
  if (t.startsWith('application/x-yaml') || t.startsWith('application/yaml') || t.startsWith('application/x-toml') || t.startsWith('application/toml')) return true;
  if (t.startsWith('application/markdown') || t.startsWith('application/x-markdown')) return true;
  if (t.startsWith('application/x-www-form-urlencoded')) return true;
  return false;
}

function checkDisallowedDownload(
  method: string,
  contentType: string,
  contentLength: string | null,
  pathname: string,
): ToolResult | null {
  if (method === 'HEAD' || method === 'OPTIONS') return null;

  const looksLikeBinaryUrl = BINARY_FILE_EXTENSIONS.test(pathname);
  if (looksLikeBinaryUrl) {
    return { success: false, output: `Use http_download for file downloads. This tool cannot be used to download binary file URL: ${pathname}`, error: 'DOWNLOAD_BLOCKED' };
  }

  const isText = isTextContentType(contentType);
  const length = contentLength ? Number.parseInt(contentLength, 10) : NaN;

  if (!isText) {
    const size = Number.isNaN(length) ? '' : ` (${length} bytes)`;
    return { success: false, output: `Use http_download for file downloads. Non-text HTTP response${size} from ${pathname} is not allowed with this tool.`, error: 'DOWNLOAD_BLOCKED' };
  }

  if (Number.isFinite(length) && length > 5 * 1024 * 1024) {
    return { success: false, output: `Response is ${length} bytes. Use http_download for large file downloads.`, error: 'DOWNLOAD_BLOCKED' };
  }

  return null;
}

function urlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export async function httpGet(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const headers = (args['headers'] as Record<string, string>) ?? {};

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  try {
    const response = await fetchWithRedirects(url, { headers, signal: AbortSignal.timeout(30000) });
    const contentType = response.headers.get('content-type') ?? '';
    const contentLength = response.headers.get('content-length');
    const pathname = urlPathname(url);

    const disallowed = checkDisallowedDownload('GET', contentType, contentLength, pathname);
    if (disallowed) {
      await response.body?.cancel?.();
      return disallowed;
    }

    let body: string;

    if (contentType.includes('json')) {
      body = JSON.stringify(await response.json(), null, 2);
    } else {
      body = await response.text();
      if (body.length > 50000) body = body.slice(0, 50000) + '\n...(truncated)';
    }

    return {
      success: response.ok,
      output: prefixWebExtractOutput(url, body),
      metadata: { status: response.status, contentType, url },
    };
  } catch (error) {
    return { success: false, output: `Request failed: ${(error as Error).message}`, error: 'HTTP_ERROR' };
  }
}

export async function httpPost(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const body = args['body'] as string | Record<string, unknown>;
  const headers = (args['headers'] as Record<string, string>) ?? {};

  const isJson = typeof body === 'object';
  if (isJson && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  try {
    const response = await fetchWithRedirects(url, {
      method: 'POST',
      headers,
      body: isJson ? JSON.stringify(body) : body as string,
      signal: AbortSignal.timeout(30000),
    });

    const contentType = response.headers.get('content-type') ?? '';
    const contentLength = response.headers.get('content-length');
    const disallowed = checkDisallowedDownload('POST', contentType, contentLength, urlPathname(url));
    if (disallowed) {
      await response.body?.cancel?.();
      return disallowed;
    }

    const text = await response.text();
    return {
      success: response.ok,
      output: text.length > 50000 ? text.slice(0, 50000) + '\n...(truncated)' : text,
      metadata: { status: response.status, contentType },
    };
  } catch (error) {
    return { success: false, output: `Request failed: ${(error as Error).message}`, error: 'HTTP_ERROR' };
  }
}

export async function httpRequest(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const method = ((args['method'] as string) ?? 'GET').toUpperCase();
  const headers = (args['headers'] as Record<string, string>) ?? {};
  const body = args['body'] as string | undefined;

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  try {
    const response = await fetchWithRedirects(url, {
      method,
      headers,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
      signal: AbortSignal.timeout(30000),
    });

    const contentType = response.headers.get('content-type') ?? '';
    const contentLength = response.headers.get('content-length');
    const disallowed = checkDisallowedDownload(method, contentType, contentLength, urlPathname(url));
    if (disallowed) {
      await response.body?.cancel?.();
      return disallowed;
    }

    const headerEntries = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
    let bodyText = '';
    if (method !== 'HEAD' && method !== 'OPTIONS') {
      bodyText = await response.text();
    }

    return {
      success: response.ok,
      output: `HTTP/${response.status} ${response.statusText}\n${headerEntries}\n\n${bodyText.slice(0, 30000)}`,
      metadata: { status: response.status, method, contentType },
    };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'HTTP_ERROR' };
  }
}

export async function webScrape(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const selector = args['selector'] as string | undefined;

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  if (BINARY_FILE_EXTENSIONS.test(urlPathname(url))) {
    return { success: false, output: 'Use http_download for file downloads. web_scrape is only for HTML/text pages.', error: 'DOWNLOAD_BLOCKED' };
  }

  try {
    const { hybridFetchAndExtract } = await import('../../search/hybrid-extract.js');
    const result = await hybridFetchAndExtract(url, { timeout: 15000 });

    let output = result.markdown || result.text;
    if (!output) {
      return { success: false, output: `Scrape returned no content: ${result.reason}`, error: 'SCRAPE_EMPTY' };
    }

    if (selector) {
      output = `(CSS selector "${selector}" requires browser — returning full extracted content)\n${output}`;
    }

    if (output.length > 30000) output = output.slice(0, 30000) + '\n...(truncated)';

    return {
      success: true,
      output: prefixWebExtractOutput(url, output),
      metadata: {
        url,
        length: output.length,
        extractor: result.winner,
        extractorReason: result.reason,
        trafilaturaQuality: result.trafilaturaQuality,
        agentFetchMethod: result.agentFetchMethod,
        overlap: result.overlap,
        hasTables: result.hasTables,
      },
    };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SCRAPE_ERROR' };
  }
}

export async function webSearch(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const query = String(args['query'] ?? '').trim();
  if (!query) {
    return { success: false, output: 'query is required', error: 'MISSING_INPUT' };
  }

  try {
    const { runWebSearch, describeActiveWebSearchProviders } = await import('../../search/providers/index.js');
    const { hasActiveWebSearchProviders, webSearchProvidersUnavailableMessage } = await import('../../search/search-config.js');
    if (!hasActiveWebSearchProviders()) {
      return {
        success: false,
        output: webSearchProvidersUnavailableMessage(),
        error: 'NO_SEARCH_PROVIDERS',
        metadata: { query, resultCount: 0 },
      };
    }
    const hits = await runWebSearch(query, 8);

    if (hits.length === 0) {
      const providers = describeActiveWebSearchProviders();
      return {
        success: true,
        output: `Web search completed with no results (queried: ${providers}). The providers are enabled — try rephrasing the query, a shorter topic, or use http_get on a known URL.`,
        metadata: { query, resultCount: 0, providers: providers.split(',').map((p) => p.trim()) },
      };
    }

    const lines = hits.map((h, i) => {
      const source = markdownSourceLink(h.url);
      return `${i + 1}. ${h.title}\n   ${h.snippet || '(no snippet)'}\n   Source: ${source} [${h.provider}]`;
    });

    return {
      success: true,
      output: lines.join('\n\n'),
      metadata: {
        query,
        resultCount: hits.length,
        providers: [...new Set(hits.map((h) => h.provider))],
        sources: hits.map((h) => h.url),
      },
    };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SEARCH_ERROR' };
  }
}

export async function httpDownload(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const headers = (args['headers'] as Record<string, string>) ?? {};
  const filenameArg = (args['filename'] as string) ?? undefined;
  let output = args['output'] as string | undefined;

  if (!url) {
    return { success: false, output: 'url is required', error: 'MISSING_INPUT' };
  }

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  try {
    const parsedUrl = new URL(url);
    const derivedName = filenameArg || basename(parsedUrl.pathname) || 'download';
    if (!output) {
      output = derivedName;
    } else if (output.endsWith('/') || output.endsWith('\\')) {
      output = output + derivedName;
    } else if (filenameArg) {
      // If a filename is explicitly given and output is a directory-like prefix, use it.
      const outBase = basename(output);
      const outDir = dirname(output);
      if (outBase !== filenameArg) {
        output = outDir === '.' ? filenameArg : `${outDir}/${filenameArg}`;
      }
    }
  } catch {
    return { success: false, output: `Invalid download URL: ${url}`, error: 'INVALID_URL' };
  }

  const filename = basename(output);
  const filePath = resolve(context.scopePath, output);
  const tmpPath = `${filePath}.part`;

  function sendProgress(progress: DownloadProgress): void {
    context.onOutput?.(JSON.stringify({ downloadProgress: progress }) + '\n');
  }

  sendProgress({
    phase: 'connecting',
    message: `Connecting to ${url}`,
    outputPath: output,
  });

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (context.signal) {
    if (context.signal.aborted) {
      return { success: false, output: 'Download cancelled', error: 'ABORTED' };
    }
    context.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const fetchHeaders: Record<string, string> = { ...headers };

    // Auth: bearer/basic token support and common env-token fallbacks.
    const auth = args['auth'] as { type?: string; token?: string; username?: string; password?: string } | undefined;
    const parsedUrl = new URL(url);
    if (auth && !fetchHeaders['authorization'] && !fetchHeaders['Authorization']) {
      if (auth.type === 'bearer' && auth.token) {
        fetchHeaders['Authorization'] = `Bearer ${auth.token}`;
      } else if (auth.type === 'basic' && auth.username && auth.password) {
        const creds = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        fetchHeaders['Authorization'] = `Basic ${creds}`;
      } else if (auth.token) {
        fetchHeaders['Authorization'] = `Bearer ${auth.token}`;
      }
    } else if (!fetchHeaders['authorization'] && !fetchHeaders['Authorization']) {
      if (parsedUrl.hostname.toLowerCase() === 'huggingface.co' && process.env['HF_TOKEN']) {
        fetchHeaders['Authorization'] = `Bearer ${process.env['HF_TOKEN']}`;
      } else if (parsedUrl.hostname.toLowerCase() === 'github.com' && process.env['GITHUB_TOKEN']) {
        fetchHeaders['Authorization'] = `Bearer ${process.env['GITHUB_TOKEN']}`;
      }
    }

    // Resume: if a previous partial download exists, ask the server to continue.
    let resumeFrom = 0;
    const resume = (args['resume'] as boolean | undefined) !== false;
    if (resume && existsSync(tmpPath)) {
      try {
        const { size } = statSync(tmpPath);
        if (size > 0) {
          resumeFrom = size;
          fetchHeaders['Range'] = `bytes=${size}-`;
        }
      } catch { /* ignore stale part file */ }
    }

    timeoutId = setTimeout(() => controller.abort(), context.timeout ?? 300_000);

    const response = await fetchWithRedirects(url, { headers: fetchHeaders, signal: controller.signal });

    // 401/403 — fail fast and explicitly so the model stops retrying.
    if (response.status === 401) {
      return { success: false, output: `Download failed: HTTP 401 — authentication required. Use the auth parameter or headers with a Bearer token.`, error: 'AUTH_REQUIRED' };
    }
    if (response.status === 403) {
      return { success: false, output: `Download failed: HTTP 403 — access denied. The file may require an auth token or accepted license terms.`, error: 'AUTH_REQUIRED' };
    }
    if (!response.ok) {
      return { success: false, output: `Download failed: HTTP ${response.status}`, error: 'HTTP_ERROR' };
    }

    const contentLength = (() => {
      const len = response.headers.get('content-length');
      if (!len) return undefined;
      const n = Number.parseInt(len, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    })();

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();

    // If the URL path clearly expects a binary file but the server served HTML/JSON,
    // we almost certainly got a login or redirect page instead of the file.
    const pathname = parsedUrl.pathname.toLowerCase();
    const looksLikeBinary = BINARY_FILE_EXTENSIONS.test(pathname);
    if (looksLikeBinary && (contentType?.startsWith('text/html') || contentType === 'application/json')) {
      rmSync(tmpPath, { force: true });
      return {
        success: false,
        output: `Download failed: server returned ${contentType} instead of the binary file. The URL may require authentication, a token, or a different direct-download link. Use the auth parameter and do not retry the same URL.`,
        error: 'AUTH_REQUIRED',
      };
    }

    // If the server ignored the Range header and returned the full file, restart from scratch.
    if (response.status !== 206) {
      resumeFrom = 0;
    }

    // Total file size: prefer Content-Range, otherwise Content-Length, otherwise fallback.
    let total: number | undefined;
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
      if (match) total = Number.parseInt(match[1]!, 10);
    }
    if (total == null && contentLength != null) {
      total = resumeFrom + contentLength;
    }

    mkdirSync(dirname(filePath), { recursive: true });
    const writer = createWriteStream(tmpPath, { flags: resumeFrom > 0 && response.status === 206 ? 'a' : 'w' });

    const body = response.body;
    if (!body) {
      writer.end();
      await new Promise<void>((resolve, reject) => writer.on('finish', resolve).on('error', reject));
      rmSync(tmpPath, { force: true });
      return { success: false, output: 'Download failed: empty response body', error: 'EMPTY_BODY' };
    }

    const reader = body.getReader();
    let downloaded = resumeFrom;
    let done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) {
        writer.write(value);
        downloaded += value.length;
        sendProgress({
          phase: 'downloading',
          message: `Downloading ${filename}`,
          downloadedBytes: downloaded,
          totalBytes: total,
          percent: total ? Math.round((downloaded / total) * 100) : undefined,
          outputPath: output,
        });
      }
    }
    writer.end();
    await new Promise<void>((resolve, reject) => writer.on('finish', resolve).on('error', reject));

    if (existsSync(filePath)) rmSync(filePath, { force: true });
    renameSync(tmpPath, filePath);

    const size = statSync(filePath).size;

    const result: DownloadResult = {
      url,
      outputPath: output,
      size,
      mimeType: contentType,
      filename,
    };

    // Surface the file as an attachment in the chat/session
    if (context.registerAttachment) {
      try {
        await context.registerAttachment({
          filename,
          mimeType: contentType,
          originalPath: filePath,
          source: 'tool',
        });
      } catch (err) {
        getLogger().warn('HTTP_DOWNLOAD', `Failed to register attachment: ${(err as Error).message}`);
      }
    }

    sendProgress({
      phase: 'done',
      message: `Downloaded ${filename} (${(size / 1024).toFixed(1)} KB)`,
      downloadedBytes: size,
      totalBytes: total ?? size,
      percent: 100,
      outputPath: output,
    });

    return {
      success: true,
      output: `Downloaded ${url} to ${output} (${size} bytes)`,
      metadata: {
        download: result,
        downloadProgress: { phase: 'done', message: 'Complete', downloadedBytes: size, totalBytes: total ?? size, percent: 100, outputPath: output },
      },
    };
  } catch (error) {
    const message = (error as Error).message;
    rmSync(tmpPath, { force: true });
    if (message.includes('abort') || (error as Error).name === 'AbortError') {
      sendProgress({
        phase: 'error',
        message: 'Download cancelled',
        outputPath: output,
      });
      return { success: false, output: 'Download cancelled', error: 'ABORTED' };
    }
    sendProgress({
      phase: 'error',
      message: `Download failed: ${message}`,
      outputPath: output,
    });
    return { success: false, output: `Download failed: ${message}`, error: 'DOWNLOAD_ERROR' };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function webBrowse(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  if (!url) return { success: false, output: 'url is required', error: 'MISSING_INPUT' };

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  // Check if Playwright is available
  if (!checkPlaywright()) {
    // Fallback to simple fetch for basic scraping
    return webScrape(args, context);
  }

  const loginRequiredSelector = (args['login_required_selector'] as string | undefined) ?? '';
  const headless = loginRequiredSelector ? args['headless'] === true : args['headless'] !== false;
  const userDataDir = args['user_data_dir'] as string | undefined;
  const loginBannerPosition = (args['login_banner_position'] as 'top' | 'bottom' | undefined) ?? 'top';
  const maxWait = context.timeout - 5000;

  const task = `
    const url = ${JSON.stringify(url)};
    const loginRequiredSelector = ${JSON.stringify(loginRequiredSelector)};
    const headless = ${JSON.stringify(headless)};
    const loginBannerPosition = ${JSON.stringify(loginBannerPosition)};
    const maxWait = ${maxWait};
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ${context.timeout - 1000} });
    const checkLogin = async () => loginRequiredSelector ? (await page.locator(loginRequiredSelector).count()) > 0 : false;
    const title = await page.title();
    const currentUrl = page.url();
    if (loginRequiredSelector && await checkLogin()) {
      if (headless) {
        return JSON.stringify({ loginRequired: true, title, url: currentUrl });
      } else {
        await page.evaluate(() => localStorage.removeItem('__agentx_continue__'));
        const injectBanner = async () => {
          await page.evaluate((position) => {
            const id = '__agentx_login_banner__';
            let el = document.getElementById(id);
            if (!el && document.body) {
              el = document.createElement('div');
              el.id = id;
              el.style.position = 'fixed';
              el.style[position] = '0';
              el.style.left = '0';
              el.style.width = '100%';
              el.style.height = '42px';
              el.style.background = '#111827';
              el.style.color = '#ffffff';
              el.style.zIndex = '999999';
              el.style.display = 'flex';
              el.style.alignItems = 'center';
              el.style.justifyContent = 'space-between';
              el.style.padding = '0 16px';
              el.style.fontFamily = 'system-ui, sans-serif';
              el.style.fontSize = '14px';
              el.style.boxSizing = 'border-box';
              el.innerHTML = '<span>Agent-X: Please log in to this site, then click Continue.</span><button id="__agentx_continue_btn__" style="background:#10b981;border:none;border-radius:4px;color:#fff;padding:6px 14px;cursor:pointer;font-weight:600;">Continue</button>';
              document.body.appendChild(el);
              const btn = document.getElementById('__agentx_continue_btn__');
              if (btn) btn.onclick = () => localStorage.setItem('__agentx_continue__', '1');
            }
          }, loginBannerPosition);
        };
        page.on('domcontentloaded', () => { injectBanner().catch(() => {}); });
        await injectBanner();
        const start = Date.now();
        let done = false;
        while (Date.now() - start < maxWait) {
          try {
            done = await page.evaluate(() => localStorage.getItem('__agentx_continue__') === '1');
          } catch { /* navigation or frame detached; keep polling */ }
          if (done) break;
          await page.waitForTimeout(500);
        }
        if (!done) throw new Error('Login wait timed out');
        await page.evaluate(() => localStorage.removeItem('__agentx_continue__'));
        if (await checkLogin()) {
          const loginTitle = await page.title();
          const loginUrl = page.url();
          return JSON.stringify({ loginFailed: true, title: loginTitle, url: loginUrl, reason: 'Login selector is still present after Continue.' });
        }
      }
    }
    const finalTitle = await page.title();
    const finalUrl = page.url();
    const text = await page.evaluate((n) => (document.body ? document.body.innerText.slice(0, n) : ''), 50000);
    return JSON.stringify({ title: finalTitle, text, url: finalUrl });
  `;

  try {
    const result = await runPlaywright(task, context, { headless, userDataDir, shield: !loginRequiredSelector });
    const parsed = JSON.parse(result.trim()) as { loginRequired?: boolean; loginFailed?: boolean; title: string; text?: string; url: string; reason?: string };
    if (parsed.loginRequired) {
      return {
        success: false,
        output: `Login required on "${parsed.title}" (${parsed.url}). Please log in to this site in the opened browser, then click Continue or say "continue" to proceed.`,
        error: 'LOGIN_REQUIRED',
        metadata: { url: parsed.url, title: parsed.title },
      };
    }
    if (parsed.loginFailed) {
      return { success: false, output: `Login not completed on "${parsed.title}" (${parsed.url}). ${parsed.reason ?? ''}`, error: 'LOGIN_FAILED' };
    }
    return { success: true, output: `Title: ${parsed.title}\n\n${parsed.text ?? ''}` };
  } catch (error) {
    return { success: false, output: `Browse failed: ${(error as Error).message}`, error: 'BROWSE_ERROR' };
  }
}
