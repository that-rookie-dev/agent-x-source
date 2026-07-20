/** Persisted when agent blocks on clarification / crew intake / incomplete turn (survives refresh). */
export type SessionResumeKind = 'questionnaire' | 'crew_intake' | 'outstanding_task';

export interface SessionResumeState {
  kind: SessionResumeKind;
  messageId: string;
  questionnaireMessageId?: string;
  /** Original user message that triggered the turn. */
  userText?: string;
  /** Last failure snippet when kind is outstanding_task. */
  lastFailure?: string;
  delegateCrewIds?: string[];
  primaryCrewId?: string;
  crewIntakeFromPicker?: boolean;
  createdAt: string;
}
