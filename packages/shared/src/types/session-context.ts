/** How this session's memory is scoped and presented to the LLM. */
export type SessionContextKind = 'agent_x' | 'crew_private';

export interface SessionCrewRosterEntry {
  crewId: string;
  name: string;
  callsign: string;
  /** deployed | mentioned | private_host */
  relationship: 'deployed' | 'mentioned' | 'private_host';
}

/** Persisted narrative memory for one session — never shared across sessions. */
export interface SessionNarrativeDocument {
  sessionId: string;
  kind: SessionContextKind;
  /** Story-style paragraphs (not chat transcripts). */
  paragraphs: string[];
  /** Primary user goal captured from the opening substantive turn. */
  intent?: string;
  /** Specialists engaged in this session. */
  crewRoster: SessionCrewRosterEntry[];
  /** What the user wants right now. */
  currentFocus?: string;
  /** Constraints / facts worth remembering. */
  facts: string[];
  turnCount: number;
  updatedAt: string;
  /** Set for crew_private — the sole crew host of the session. */
  hostCrewId?: string;
}

export interface SessionContextLimits {
  maxNarrativeChars?: number;
  maxParagraphs?: number;
  maxFacts?: number;
}

export interface SessionContextPolicy {
  kind: SessionContextKind;
  limits: SessionContextLimits;
  /** crew_private sessions keep richer narrative within the same session. */
  retention: 'session_only';
}
