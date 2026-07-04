import type { DeepSearchResultBundle } from '@agentx/shared/browser';
import { extractUrlsFromText } from './source-chip-utils';
import type { PartEntry } from './types';

const WEB_EXTRACTION_TOOLS = new Set([
  'web_search',
  'deep_web_search',
  'web_fetch',
  'web_scrape',
  'web_browse',
  'http_get',
  'http_post',
]);

function parseToolArgs(args: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'object') return args;
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function addUrl(seen: Set<string>, ordered: string[], url: string | undefined | null): void {
  if (!url || !url.startsWith('http')) return;
  const clean = url.replace(/[.,;:!?)]+$/g, '');
  if (seen.has(clean)) return;
  seen.add(clean);
  ordered.push(clean);
}

function addFromDeepSearchBundle(
  seen: Set<string>,
  ordered: string[],
  bundle: DeepSearchResultBundle | undefined,
): void {
  for (const result of bundle?.results ?? []) {
    addUrl(seen, ordered, result.url);
  }
}

/** Collect ordered source URLs from web tool parts in an assistant message. */
export function collectWebSourceUrls(parts: PartEntry[] | undefined): string[] {
  if (!parts?.length) return [];

  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const part of parts) {
    if (part.type === 'deep_search') {
      addFromDeepSearchBundle(seen, ordered, part.deepSearch?.bundle);
      continue;
    }

    if (part.type !== 'tool' || !part.tool) continue;
    const tool = part.tool;
    if (!WEB_EXTRACTION_TOOLS.has(tool.name)) continue;

    const args = parseToolArgs(tool.args);
    addUrl(seen, ordered, args['url'] as string | undefined);

    addFromDeepSearchBundle(
      seen,
      ordered,
      tool.metadata?.deepSearch as DeepSearchResultBundle | undefined,
    );

    addUrl(seen, ordered, tool.metadata?.url as string | undefined);

    const metaSources = tool.metadata?.sources;
    if (Array.isArray(metaSources)) {
      for (const entry of metaSources) {
        addUrl(seen, ordered, String(entry));
      }
    }

    for (const url of extractUrlsFromText(tool.result ?? '')) {
      addUrl(seen, ordered, url);
    }
    for (const url of extractUrlsFromText(tool.streamOutput ?? '')) {
      addUrl(seen, ordered, url);
    }
  }

  return ordered;
}

export function messageUsedWebExtraction(parts: PartEntry[] | undefined): boolean {
  if (!parts?.length) return false;
  return parts.some((p) =>
    p.type === 'deep_search'
    || (p.type === 'tool' && p.tool && WEB_EXTRACTION_TOOLS.has(p.tool.name)),
  );
}
