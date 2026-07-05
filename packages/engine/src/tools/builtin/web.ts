import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { markdownSourceLink, prefixWebExtractOutput, assertSafeFetchUrl } from '../../search/url-utils.js';

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

export async function httpGet(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const headers = (args['headers'] as Record<string, string>) ?? {};

  try {
    assertSafeFetchUrl(url);
  } catch {
    return blockedUrlResult(url);
  }

  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    const contentType = response.headers.get('content-type') ?? '';
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
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: isJson ? JSON.stringify(body) : body as string,
      signal: AbortSignal.timeout(30000),
    });

    const text = await response.text();
    return {
      success: response.ok,
      output: text.length > 50000 ? text.slice(0, 50000) + '\n...(truncated)' : text,
      metadata: { status: response.status },
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
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
      signal: AbortSignal.timeout(30000),
    });

    const text = await response.text();
    const headerEntries = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');

    return {
      success: response.ok,
      output: `HTTP/${response.status} ${response.statusText}\n${headerEntries}\n\n${text.slice(0, 30000)}`,
      metadata: { status: response.status, method },
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

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AgentX/0.1' },
      signal: AbortSignal.timeout(15000),
    });

    const html = await response.text();

    // Basic text extraction — strip HTML tags
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (selector) {
      text = `(CSS selector "${selector}" requires browser — returning full text)\n${text}`;
    }

    if (text.length > 30000) text = text.slice(0, 30000) + '\n...(truncated)';

    return { success: true, output: prefixWebExtractOutput(url, text), metadata: { url, length: text.length } };
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
      return {
        success: false,
        output: `No web results found. Active providers: ${describeActiveWebSearchProviders()}. Enable DuckDuckGo or configure BYOK providers in Settings → Tools → Web Search.`,
        metadata: { query, resultCount: 0 },
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
  const output = args['output'] as string;

  if (!url || !output) {
    return { success: false, output: 'url and output are required', error: 'MISSING_INPUT' };
  }

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      return { success: false, output: `Download failed: HTTP ${response.status}`, error: 'HTTP_ERROR' };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = resolve(context.scopePath, output);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buffer);
    return { success: true, output: `Downloaded ${url} to ${output} (${buffer.length} bytes)`, metadata: { size: buffer.length } };
  } catch (error) {
    return { success: false, output: `Download failed: ${(error as Error).message}`, error: 'DOWNLOAD_ERROR' };
  }
}

export async function webBrowse(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  if (!url) return { success: false, output: 'url is required', error: 'MISSING_INPUT' };

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  // Check if Playwright is available
  try {
    execSync('npx playwright --version 2>/dev/null', { timeout: 5000 });
  } catch {
    // Fallback to simple fetch for basic scraping
    return webScrape(args, context);
  }

  const script = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(${JSON.stringify(url)}, { timeout: 30000 });
      const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText.slice(0, 50000));
      await browser.close();
      console.log(JSON.stringify({ title, text }));
    })();
  `;

  try {
    const result = execSync(`node -e ${JSON.stringify(script)}`, { timeout: 30000, encoding: 'utf-8', cwd: context.scopePath });
    const parsed = JSON.parse(result.trim());
    return { success: true, output: `Title: ${parsed.title}\n\n${parsed.text}` };
  } catch (error) {
    return { success: false, output: `Browse failed: ${(error as Error).message}`, error: 'BROWSE_ERROR' };
  }
}
