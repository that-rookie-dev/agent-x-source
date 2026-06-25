import type { CrewSuggestionEvaluation } from './crew-catalog.js';

export type CrewRosterPickerStatus = 'pending' | 'answered' | 'skipped';

/** Persisted in-chat crew roster picker (assistant message part). */
export interface CrewRosterPickerRecord {
  id: string;
  status: CrewRosterPickerStatus;
  evaluation: CrewSuggestionEvaluation;
  pendingUserText: string;
  selectedCandidateIds?: string[];
}
