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
  options?: AskClarificationOptionInput[];
  allowFreeform?: boolean;
  recommended?: string;
  allowChooseAll?: boolean;
  selectionMode?: 'single' | 'multiple';
  fields?: ClarificationField[];
  title?: string;
  source?: ClarificationSource;
}

/** LLM tool args often send options as plain strings, but sometimes as `{label}` / `{value,label}` objects. */
export type AskClarificationOptionInput =
  | string
  | number
  | boolean
  | { value?: unknown; label?: unknown; text?: unknown; name?: unknown }
  | null
  | undefined;

export interface AskClarificationToolArgs {
  title?: string;
  question?: string;
  options?: AskClarificationOptionInput[];
  multiple?: boolean;
  allowFreeform?: boolean;
  recommended?: string;
  fields?: ClarificationField[];
  questions?: Array<{
    id?: string;
    prompt?: string;
    type?: string;
    options?: AskClarificationOptionInput[];
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

/** Coerce one option from tool args into a display/value string. */
export function coerceQuestionnaireOptionText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (!raw || typeof raw !== 'object') return '';
  const obj = raw as Record<string, unknown>;
  for (const key of ['label', 'value', 'text', 'name'] as const) {
    const nested = obj[key];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    // Nested `{ label: "…" }` (seen when models wrap option strings)
    if (nested && typeof nested === 'object') {
      const deeper = coerceQuestionnaireOptionText(nested);
      if (deeper) return deeper;
    }
  }
  return '';
}

function capOptions(raw: AskClarificationOptionInput[] | undefined, recommended?: string): QuestionnaireOption[] {
  if (!raw?.length) return [];
  const recommendedText = coerceQuestionnaireOptionText(recommended);
  const out: QuestionnaireOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_QUESTIONNAIRE_CHOICES) break;
    const text = coerceQuestionnaireOptionText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({
      value: text,
      label: text,
      recommended: recommendedText !== '' && recommendedText === text,
    });
  }
  return out;
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
  options: AskClarificationOptionInput[],
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

/** Repair questionnaire options that were persisted as nested `{label}` objects. */
export function sanitizeQuestionnairePayload(payload: QuestionnairePayload): QuestionnairePayload {
  return {
    ...payload,
    questions: payload.questions.map((q) => {
      if (!q.options?.length) return q;
      const options = capOptions(
        q.options.map((o) => ({ value: o.value, label: o.label })),
        q.options.find((o) => o.recommended)?.value,
      );
      if (options.length === 0) {
        return {
          id: q.id,
          prompt: q.prompt,
          type: 'text' as const,
          required: q.required !== false,
          placeholder: 'Type your answer…',
        };
      }
      return { ...q, options };
    }),
  };
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

type QuestionnairePart = {
  type?: string;
  questionnaire?: { status?: string; answer?: string };
};

type HistoryMessageLike = {
  role?: string;
  content?: string;
  parts?: unknown;
};

/** Collect answered questionnaire text from assistant message parts (chronological). */
export function collectAnsweredQuestionnaireTexts(messages: HistoryMessageLike[]): string[] {
  const answers: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.parts)) continue;
    for (const part of msg.parts as QuestionnairePart[]) {
      if (part.type !== 'questionnaire') continue;
      const answer = part.questionnaire?.answer?.trim();
      if (part.questionnaire?.status === 'answered' && answer) {
        answers.push(answer);
      }
    }
  }
  return answers;
}

/**
 * Build LLM history entries from stored messages, injecting questionnaire answers
 * as user-role context (answers live in assistant message parts, not content).
 */
export function hydrateMessageHistoryEntries(
  messages: HistoryMessageLike[],
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  const entries: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  for (const msg of messages) {
    const role = msg.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    if (role === 'system' && !msg.content?.includes('[TURN TOOL LEDGER]')) continue;

    if (msg.content?.trim()) {
      entries.push({ role: role as 'user' | 'assistant' | 'system', content: msg.content });
    }

    if (role === 'assistant' && Array.isArray(msg.parts)) {
      for (const part of msg.parts as QuestionnairePart[]) {
        if (part.type !== 'questionnaire') continue;
        const answer = part.questionnaire?.answer?.trim();
        if (part.questionnaire?.status === 'answered' && answer) {
          entries.push({ role: 'user', content: answer });
        }
      }
    }
  }
  return entries;
}
