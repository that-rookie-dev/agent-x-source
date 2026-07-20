/** Target for initiating a secure crew voice call. */
export interface CrewCallRecruitPayload {
  id?: string;
  name: string;
  title?: string;
  callsign?: string;
  systemPrompt: string;
  description?: string;
  tone?: string;
  expertise?: string[];
  traits?: string[];
  tools?: string[];
  source?: string;
  catalogId?: string;
  categoryId?: string;
  color?: string;
}

export interface CrewCallTarget {
  /** Existing crew-private session — skip create when set. */
  sessionId?: string;
  /** Roster crew id when already imported. */
  crewId?: string;
  /** Hub recruit payload when calling before/without roster id. */
  recruit?: CrewCallRecruitPayload;
  displayName: string;
  callsign: string;
  title?: string;
  accent?: string;
}

export type CrewCallPhase =
  | 'idle'
  | 'resolving'
  | 'connecting'
  | 'encoding'
  | 'linked'
  | 'on_hold'
  | 'ending'
  | 'failed';

export interface CrewCallTranscriptLine {
  id: string;
  role: 'operator' | 'crew' | 'system';
  text: string;
  at: number;
}
