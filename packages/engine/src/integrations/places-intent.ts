/** Detect local places / directions queries that should use Google Maps MCP, not web search. */
const PLACES_SEARCH_RE =
  /\b(restaurant|restaurants|cafe|cafes|coffee\s+shop|hotel|hotels|motel|bar|pub|steak|steakhouse|bakery|food|dining|places?\s+to\s+eat|nearby|near\s+me|directions?\s+to|route\s+to|how\s+far|travel\s+time|distance\s+to|geocode|address\s+of|where\s+is|find\s+.+\s+in|best\s+.+\s+in|top\s+.+\s+in|good\s+.+\s+in)\b/i;

const MAPS_PROVIDER_MENTION_RE = /\b(google\s*maps?|maps?\s*mcp|places?\s*api)\b/i;

export function detectPlacesSearchRequest(text: string): boolean {
  return PLACES_SEARCH_RE.test(text.trim());
}

export function mentionsGoogleMapsProvider(text: string): boolean {
  return MAPS_PROVIDER_MENTION_RE.test(text.trim());
}
