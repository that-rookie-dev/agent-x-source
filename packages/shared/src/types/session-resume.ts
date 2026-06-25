/** Persisted when agent blocks on clarification / crew intake (survives refresh). */
export type SessionResumeKind = 'questionnaire' | 'crew_intake';

export interface SessionResumeState {
  kind: SessionResumeKind;
  messageId: string;
  questionnaireMessageId?: string;
  /** Original user message that triggered the turn. */
  userText?: string;
  delegateCrewIds?: string[];
  primaryCrewId?: string;
  crewIntakeFromPicker?: boolean;
  createdAt: string;
}
