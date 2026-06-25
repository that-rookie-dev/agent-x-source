import type { ToolExecutionContext, ToolResult } from '@agentx/shared';

export interface CrewHubSearchHit {
  id: string;
  callsign: string;
  name: string;
  title: string;
  matchScore: number;
  expertise: string[];
  onRoster: boolean;
  origin: string;
  categoryLabel?: string;
}

export type CrewHubSearcher = (
  query: string,
  sessionId: string,
  limit?: number,
) => Promise<CrewHubSearchHit[]>;

let crewHubSearcher: CrewHubSearcher | null = null;

export function setCrewHubSearcher(fn: CrewHubSearcher | null): void {
  crewHubSearcher = fn;
}

export async function searchCrewHub(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const query = String(args['query'] ?? '').trim();
  if (!query) {
    return { success: false, output: 'query is required', error: 'MISSING_QUERY' };
  }

  const limit = Math.min(Math.max(Number(args['limit']) || 5, 1), 10);

  if (!crewHubSearcher) {
    return { success: false, output: 'Crew catalog is unavailable in this session.', error: 'CATALOG_UNAVAILABLE' };
  }

  try {
    const hits = await crewHubSearcher(query, context.sessionId, limit);
    if (hits.length === 0) {
      return {
        success: true,
        output: JSON.stringify({
          query,
          count: 0,
          message: 'No crew matches — proceed as Agent-X.',
          crews: [],
        }, null, 2),
      };
    }
    return {
      success: true,
      output: JSON.stringify({ query, count: hits.length, crews: hits }, null, 2),
    };
  } catch (e: unknown) {
    return {
      success: false,
      output: e instanceof Error ? e.message : 'crew search failed',
      error: 'SEARCH_FAILED',
    };
  }
}
