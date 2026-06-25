import type {
  ClarificationField,
  ClarificationRequestMeta,
  ClarificationSource,
} from '../types/events.js';
import type {
  QuestionnaireOption,
  QuestionnairePayload,
  QuestionnaireQuestion,
  QuestionnaireResponseState,
} from '../types/questionnaire.js';
import { MAX_QUESTIONNAIRE_CHOICES, QUESTIONNAIRE_CUSTOM_SUFFIX } from '../types/questionnaire.js';

function newQuestionnaireId(): string {
  return crypto.randomUUID();
}

export { MAX_QUESTIONNAIRE_CHOICES, QUESTIONNAIRE_CUSTOM_SUFFIX };

export interface LegacyClarificationInput {
  question: string;
  options?: string[];
  allowFreeform?: boolean;
  recommended?: string;
  allowChooseAll?: boolean;
  selectionMode?: 'single' | 'multiple';
  fields?: ClarificationField[];
  title?: string;
  source?: ClarificationSource;
}

export interface AskClarificationToolArgs {
  title?: string;
  question?: string;
  options?: string[];
  multiple?: boolean;
  allowFreeform?: boolean;
  recommended?: string;
  fields?: ClarificationField[];
  questions?: Array<{
    id?: string;
    prompt?: string;
    type?: string;
    options?: string[];
    allowCustom?: boolean;
    required?: boolean;
    placeholder?: string;
    multiline?: boolean;
    recommended?: string;
  }>;
}

function slugId(prefix: string, index: number): string {
  return `${prefix}_${index + 1}`;
}

function capOptions(raw: string[] | undefined, recommended?: string): QuestionnaireOption[] {
  if (!raw?.length) return [];
  return raw.slice(0, MAX_QUESTIONNAIRE_CHOICES).map((value) => ({
    value,
    label: value,
    recommended: recommended === value,
  }));
}

function normalizeQuestion(
  raw: NonNullable<AskClarificationToolArgs['questions']>[number],
  index: number,
): QuestionnaireQuestion | null {
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (!prompt) return null;

  const type = raw.type === 'single_choice' || raw.type === 'multi_choice' || raw.type === 'text'
    ? raw.type
    : Array.isArray(raw.options) && raw.options.length > 0
      ? 'single_choice'
      : 'text';

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : slugId('q', index);

  if (type === 'text') {
    return {
      id,
      prompt,
      type: 'text',
      required: raw.required !== false,
      placeholder: raw.placeholder,
      multiline: raw.multiline === true,
    };
  }

  const options = capOptions(raw.options, raw.recommended);
  if (options.length === 0) {
    return {
      id,
      prompt,
      type: 'text',
      required: raw.required !== false,
      placeholder: raw.placeholder ?? 'Type your answer…',
      multiline: raw.multiline === true,
    };
  }

  return {
    id,
    prompt,
    type,
    options,
    allowCustom: raw.allowCustom !== false,
    required: raw.required !== false,
  };
}

/** Build a canonical questionnaire from ask_clarification tool arguments. */
export function normalizeAskClarificationArgs(
  args: AskClarificationToolArgs,
  source?: ClarificationSource,
): QuestionnairePayload {
  const title = typeof args.title === 'string' ? args.title.trim() : undefined;

  if (Array.isArray(args.questions) && args.questions.length > 0) {
    const questions = args.questions
      .map((q, i) => normalizeQuestion(q, i))
      .filter((q): q is QuestionnaireQuestion => q !== null);
    if (questions.length > 0) {
      return {
        id: newQuestionnaireId(),
        title,
        questions,
        allowSkip: false,
        source,
      };
    }
  }

  return legacyClarificationToQuestionnaire({
    question: typeof args.question === 'string' ? args.question : 'Could you clarify?',
    options: Array.isArray(args.options) ? args.options : [],
    allowFreeform: args.allowFreeform !== false,
    recommended: typeof args.recommended === 'string' ? args.recommended : undefined,
    selectionMode: args.multiple ? 'multiple' : undefined,
    fields: Array.isArray(args.fields) ? args.fields : undefined,
    title,
    source,
  });
}

/** Convert legacy single-question clarification shapes into a questionnaire. */
export function legacyClarificationToQuestionnaire(input: LegacyClarificationInput): QuestionnairePayload {
  const questionText = input.question.trim() || 'Could you clarify?';
  const questions: QuestionnaireQuestion[] = [];

  if (input.fields?.length) {
    for (const [i, field] of input.fields.entries()) {
      questions.push({
        id: field.key || slugId('field', i),
        prompt: field.label,
        type: 'text',
        required: field.required !== false,
        placeholder: field.placeholder,
        multiline: field.type === 'textarea',
      });
    }
  } else if (input.selectionMode === 'multiple' && input.options && input.options.length > 0) {
    questions.push({
      id: 'choices',
      prompt: questionText,
      type: 'multi_choice',
      options: capOptions(input.options, input.recommended),
      allowCustom: input.allowFreeform !== false,
      required: true,
    });
  } else if (input.options && input.options.length > 0) {
    questions.push({
      id: 'choices',
      prompt: questionText,
      type: 'single_choice',
      options: capOptions(input.options, input.recommended),
      allowCustom: input.allowFreeform !== false,
      required: true,
    });
  } else {
    questions.push({
      id: 'text',
      prompt: questionText,
      type: 'text',
      required: true,
      placeholder: 'Type your answer…',
    });
  }

  return {
    id: newQuestionnaireId(),
    title: input.title,
    questions,
    allowSkip: true,
    source: input.source,
  };
}

/** Merge event meta + legacy fields into a questionnaire (for transitional callers). */
export function resolveClarificationQuestionnaire(
  question: string,
  options: string[],
  allowFreeform: boolean,
  meta?: ClarificationRequestMeta,
  source?: ClarificationSource,
): QuestionnairePayload {
  if (meta?.questionnaire) {
    return {
      ...meta.questionnaire,
      source: meta.questionnaire.source ?? source,
    };
  }
  return legacyClarificationToQuestionnaire({
    question,
    options,
    allowFreeform,
    recommended: meta?.recommended,
    allowChooseAll: meta?.allowChooseAll,
    selectionMode: meta?.selectionMode,
    fields: meta?.fields,
    source,
  });
}

export function initialQuestionnaireState(payload: QuestionnairePayload): QuestionnaireResponseState {
  const state: QuestionnaireResponseState = {};

  for (const q of payload.questions) {
    if (q.type === 'single_choice') {
      const recommended = q.options?.find((o) => o.recommended)?.value ?? null;
      state[q.id] = recommended;
    } else if (q.type === 'multi_choice') {
      const recommended = q.options?.find((o) => o.recommended)?.value;
      state[q.id] = new Set(recommended ? [recommended] : []);
    } else {
      state[q.id] = '';
    }
    if (q.allowCustom !== false && (q.type === 'single_choice' || q.type === 'multi_choice')) {
      state[`${q.id}${QUESTIONNAIRE_CUSTOM_SUFFIX}`] = '';
    }
  }

  return state;
}

function readCustom(state: QuestionnaireResponseState, questionId: string): string {
  return ((state[`${questionId}${QUESTIONNAIRE_CUSTOM_SUFFIX}`] as string) ?? '').trim();
}

function formatSingleAnswer(q: QuestionnaireQuestion, state: QuestionnaireResponseState): string | null {
  const custom = readCustom(state, q.id);
  if (custom) return custom;
  const selected = state[q.id] as string | null;
  if (!selected?.trim()) return q.required === false ? '' : null;
  return selected;
}

function formatMultiAnswer(q: QuestionnaireQuestion, state: QuestionnaireResponseState): string | null {
  const custom = readCustom(state, q.id);
  const selected = state[q.id] as Set<string> | undefined;
  const values = selected ? [...selected] : [];
  if (custom) values.push(custom);
  if (values.length === 0) return q.required === false ? '' : null;
  return values.join(', ');
}

function formatTextAnswer(q: QuestionnaireQuestion, state: QuestionnaireResponseState): string | null {
  const text = ((state[q.id] as string) ?? '').trim();
  if (!text) return q.required === false ? '' : null;
  return text;
}

/** Returns null when required answers are missing. */
export function formatQuestionnaireAnswers(
  payload: QuestionnairePayload,
  state: QuestionnaireResponseState,
): string | null {
  const lines: string[] = [];

  for (const q of payload.questions) {
    let answer: string | null;
    if (q.type === 'single_choice') answer = formatSingleAnswer(q, state);
    else if (q.type === 'multi_choice') answer = formatMultiAnswer(q, state);
    else answer = formatTextAnswer(q, state);

    if (answer === null) return null;
    if (answer === '' && q.required === false) continue;
    lines.push(`${q.prompt}: ${answer}`);
  }

  if (lines.length === 0) return null;
  return lines.join('\n');
}

export function canSubmitQuestionnaire(
  payload: QuestionnairePayload,
  state: QuestionnaireResponseState,
): boolean {
  return formatQuestionnaireAnswers(payload, state) !== null;
}

/** Build a single text question (e.g. crew mission clarification). */
export function buildTextQuestionnaire(opts: {
  prompt: string;
  title?: string;
  source?: ClarificationSource;
  placeholder?: string;
}): QuestionnairePayload {
  return {
    id: newQuestionnaireId(),
    title: opts.title,
    source: opts.source,
    allowSkip: false,
    questions: [{
      id: 'text',
      prompt: opts.prompt,
      type: 'text',
      required: true,
      placeholder: opts.placeholder ?? 'Type your answer…',
    }],
  };
}
