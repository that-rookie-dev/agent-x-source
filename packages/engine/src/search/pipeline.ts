import { generateId } from '@agentx/shared';
import type {
  DeepSearchDepth,
  DeepSearchProgress,
  DeepSearchRequest,
  DeepSearchResult,
  DeepSearchResultBundle,
} from '@agentx/shared';
import { depthBudget, planSearchQueries } from './planner.js';
import { runWebSearch, type SerpHit } from './providers/index.js';
import { hasActiveWebSearchProviders, webSearchProvidersUnavailableMessage } from './search-config.js';
import { fetchAndExtractPage, inferTypeFromPage, pageExtractToDeepSearchExtracted } from './extract.js';
import { preScoreSerpHit, scoreSearchResult } from './score.js';
import { extractDomain, faviconUrlForDomain, isUrlSafeForFetch, markdownSourceLink } from './url-utils.js';

export type ProgressCallback = (progress: DeepSearchProgress) => void;

let globalStageResult: ((result: DeepSearchResult) => Promise<void> | void) | undefined;

export function setDeepSearchStageResult(stage: (result: DeepSearchResult) => Promise<void> | void): void {
  globalStageResult = stage;
}

export async function runDeepSearchPipeline(
  request: DeepSearchRequest,
  onProgress?: ProgressCallback,
  stageResult?: (result: DeepSearchResult) => Promise<void> | void,
): Promise<DeepSearchResultBundle> {
  const started = Date.now();
  const depth: DeepSearchDepth = request.depth ?? 'standard';
  const budget = depthBudget(depth);
  const maxResults = Math.min(request.maxResults ?? budget.maxResults, budget.maxResults);
  const query = request.query.trim();

  const emit = (progress: DeepSearchProgress) => onProgress?.(progress);

  if (!hasActiveWebSearchProviders()) {
    const message = webSearchProvidersUnavailableMessage();
    emit({ phase: 'done', message });
    return {
      query,
      depth,
      plan: { subQueries: [query], intent: [] },
      stats: { searched: 0, fetched: 0, kept: 0, ms: Date.now() - started },
      results: [],
      summary: message,
    };
  }

  emit({ phase: 'planning', message: 'Planning search queries…' });
  const plan = planSearchQueries(query, depth);

  emit({ phase: 'searching', message: 'Searching the web…', total: plan.subQueries.length });
  const serpBatches = await Promise.all(
    plan.subQueries.map((q) => runWebSearch(q, budget.serpPerQuery)),
  );
  const merged = dedupeSerp(serpBatches.flat());
  const searched = merged.length;

  const preRanked = merged
    .map((hit) => ({ hit, pre: preScoreSerpHit(query, hit) }))
    .sort((a, b) => b.pre - a.pre)
    .slice(0, budget.fetchCount);

  emit({
    phase: 'fetching',
    message: `Scanning top ${preRanked.length} sources…`,
    searched,
    fetched: 0,
    total: preRanked.length,
  });

  const fetchedResults: DeepSearchResult[] = [];
  let fetchedCount = 0;

  await Promise.all(preRanked.map(async ({ hit }) => {
    if (!isUrlSafeForFetch(hit.url)) return;
    const page = await fetchAndExtractPage(hit.url).catch(() => null);
    fetchedCount += 1;
    emit({
      phase: 'fetching',
      message: `Scanned ${fetchedCount}/${preRanked.length} sources…`,
      searched,
      fetched: fetchedCount,
      total: preRanked.length,
    });

    const contentType = inferTypeFromPage(hit.url, page);
    const scores = scoreSearchResult({
      query,
      hit,
      page,
      contentType,
      intent: plan.intent,
    });
    const domain = hit.domain || extractDomain(hit.url);
    const extracted = pageExtractToDeepSearchExtracted(page ?? {
      title: hit.title,
      description: hit.snippet,
      excerpt: hit.snippet,
    });

    const result: DeepSearchResult = {
      id: generateId(),
      url: hit.url,
      title: page?.title || hit.title,
      snippet: page?.description || hit.snippet,
      domain,
      faviconUrl: faviconUrlForDomain(domain),
      contentType,
      scores,
      extracted,
      source: {
        provider: hit.provider,
        fetchedAt: new Date().toISOString(),
      },
    };
    fetchedResults.push(result);
    const stager = stageResult ?? globalStageResult;
    if (stager) {
      try { await stager(result); } catch { /* best-effort staging */ }
    }
  }));

  emit({ phase: 'scoring', message: 'Ranking results…', searched, fetched: fetchedCount });

  const results = fetchedResults
    .sort((a, b) => b.scores.final - a.scores.final)
    .slice(0, maxResults);

  const summary = buildSummary(query, results);
  const ms = Date.now() - started;

  emit({ phase: 'done', message: `Found ${results.length} ranked results`, searched, fetched: fetchedCount });

  return {
    query,
    depth,
    plan,
    stats: { searched, fetched: fetchedCount, kept: results.length, ms },
    results,
    summary,
  };
}

function dedupeSerp(hits: SerpHit[]): SerpHit[] {
  const seen = new Set<string>();
  const out: SerpHit[] = [];
  for (const hit of hits) {
    const key = hit.url.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function buildSummary(query: string, results: DeepSearchResult[]): string {
  if (results.length === 0) {
    return `No high-quality web results found for "${query}".`;
  }
  const lines = results.slice(0, 5).map((r, i) => (
    `${i + 1}. [${r.contentType}] ${r.title} — ${markdownSourceLink(r.url)} (score ${r.scores.final})`
  ));
  return `Deep web search for "${query}" found ${results.length} ranked result(s):\n${lines.join('\n')}`;
}
