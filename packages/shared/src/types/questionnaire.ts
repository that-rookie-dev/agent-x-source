import type { ClarificationSource } from './events.js';

export const MAX_QUESTIONNAIRE_CHOICES = 5;

export type QuestionnaireQuestionType = 'text' | 'single_choice' | 'multi_choice';

export interface QuestionnaireOption {
  value: string;
  label?: string;
  recommended?: boolean;
  /** When true, option is visible but not selectable (e.g. channel not configured). */
  disabled?: boolean;
}

export interface QuestionnaireQuestion {
  id: string;
  prompt: string;
  type: QuestionnaireQuestionType;
  options?: QuestionnaireOption[];
  /** Allow a typed custom answer (choice questions). Default true. */
  allowCustom?: boolean;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
}

export interface QuestionnairePayload {
  id: string;
  title?: string;
  questions: QuestionnaireQuestion[];
  allowSkip?: boolean;
  submitLabel?: string;
  source?: ClarificationSource;
}

/** Per-question answer while the form is being filled. */
export type QuestionnaireAnswerValue =
  | string
  | Set<string>
  | null;

export type QuestionnaireResponseState = Record<string, QuestionnaireAnswerValue>;

export const QUESTIONNAIRE_CUSTOM_SUFFIX = '__custom';

/** Persisted questionnaire state on a chat message part. */
export interface QuestionnaireRecord extends Record<string, unknown> {
  payload: QuestionnairePayload;
  status: 'pending' | 'answered' | 'skipped';
  answer?: string;
  answeredAt?: string;
}
