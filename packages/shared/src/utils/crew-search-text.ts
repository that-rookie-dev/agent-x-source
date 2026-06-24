export interface CrewSearchTextInput {
  name: string;
  title?: string;
  callsign?: string;
  description?: string;
  tone?: string;
  expertise?: string[];
  traits?: string[];
  /** Only first ~400 chars of prompt are indexed for privacy. */
  systemPrompt?: string;
}

/** Build a lowercase search blob for FTS / keyword matching. */
export function buildCrewSearchText(input: CrewSearchTextInput): string {
  const promptSnippet = (input.systemPrompt ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);

  return [
    input.name,
    input.title ?? '',
    input.callsign ?? '',
    input.description ?? '',
    input.tone ?? '',
    ...(input.expertise ?? []),
    ...(input.traits ?? []),
    promptSnippet,
  ]
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable hub catalog id from callsign. */
export function hubCatalogIdFromCallsign(callsign: string): string {
  return `hub-${callsign}`;
}
