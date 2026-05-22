import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function httpGet(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const headers = (args['headers'] as Record<string, string>) ?? {};

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
      output: body,
      metadata: { status: response.status, contentType },
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

    return { success: true, output: text, metadata: { url, length: text.length } };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SCRAPE_ERROR' };
  }
}

export async function webSearch(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const query = args['query'] as string;
  // Use DuckDuckGo HTML for basic search (no API key needed)
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AgentX/0.1' },
      signal: AbortSignal.timeout(10000),
    });

    const html = await response.text();
    // Extract result snippets
    const results: string[] = [];
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = snippetRegex.exec(html)) !== null && results.length < 5) {
      const text = match[1]!.replace(/<[^>]+>/g, '').trim();
      if (text) results.push(text);
    }

    return {
      success: true,
      output: results.length > 0 ? results.join('\n\n') : 'No results found',
      metadata: { query, resultCount: results.length },
    };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SEARCH_ERROR' };
  }
}
