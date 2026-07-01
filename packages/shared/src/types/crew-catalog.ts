/** Origin of a crew in the suggestion / match pool. */
export type CrewCandidateOrigin = 'hub_catalog' | 'custom' | 'hub_roster';

export interface CatalogCategory {
  id: string;
  label: string;
  iconId?: string;
  requiresMedicalDisclaimer?: boolean;
}

export interface CatalogEntry {
  id: string;
  callsign: string;
  name: string;
  title: string;
  categoryId: string;
  categoryLabel: string;
  description: string;
  systemPrompt: string;
  tone?: string;
  expertise: string[];
  traits: string[];
  tools?: string[];
  tags?: string[];
  searchText: string;
  hubRevision: number;
  active: boolean;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
}

/** Hub browse card — omits heavy fields (system prompt, search text). */
export interface CatalogSummary {
  id: string;
  callsign: string;
  name: string;
  title: string;
  categoryId: string;
  categoryLabel: string;
  description: string;
  expertise: string[];
  traits: string[];
  tone?: string;
  tools?: string[];
  tags?: string[];
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
}

export interface CatalogCategorySummary {
  id: string;
  label: string;
  iconId?: string;
  crewCount: number;
}

export interface CrewMatchCandidate {
  id: string;
  origin: CrewCandidateOrigin;
  callsign: string;
  name: string;
  title: string;
  categoryId?: string;
  categoryLabel?: string;
  description: string;
  expertise: string[];
  traits: string[];
  tone?: string;
  tools?: string[];
  tags?: string[];
  /** Normalized 0–1 compatibility score for the current task. */
  matchScore: number;
  /** Human-readable match reasons. */
  reasons: string[];
  /** True when crew is already on the user roster. */
  onRoster: boolean;
  /** True when roster crew is enabled for agent use. */
  enabled?: boolean;
  catalogId?: string;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
}

export interface CrewSuggestionEvaluation {
  shouldSuggest: boolean;
  dismissed: boolean;
  confidence: number;
  taskSummary: string;
  candidates: CrewMatchCandidate[];
  reasons: string[];
}

export interface SessionCrewPreferences {
  sessionId: string;
  suggestionsDismissed: boolean;
  dismissedAt?: string;
  lastSuggestionAt?: string;
  lastSuggestionTurnId?: string;
  updatedAt: string;
}

export interface CatalogManifest {
  revision: number;
  categories: CatalogCategory[];
  crews: Array<{
    id: string;
    categoryId: string;
    categoryLabel: string;
    name: string;
    title: string;
    callsign: string;
    description: string;
    systemPrompt: string;
    tone: string;
    expertise: string[];
    traits: string[];
    tools?: string[];
    tags?: string[];
    searchText: string;
  }>;
}
