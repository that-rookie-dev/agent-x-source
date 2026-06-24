import type { ClarificationField, ClarificationSource } from '@agentx/shared';

export type { ClarificationField, ClarificationSource };

export interface QuestionnaireOption {
  value: string;
  label?: string;
  recommended?: boolean;
}

export interface SingleChoiceBlock {
  id: string;
  type: 'single_choice';
  options: QuestionnaireOption[];
  allowAll?: boolean;
  allowFreeform?: boolean;
}

export interface MultiChoiceBlock {
  id: string;
  type: 'multi_choice';
  options: QuestionnaireOption[];
  allowAll?: boolean;
}

export interface TextBlock {
  id: string;
  type: 'text';
  placeholder?: string;
  multiline?: boolean;
}

export interface FormFieldsBlock {
  id: string;
  type: 'form_fields';
  fields: ClarificationField[];
}

export type QuestionnaireBlock =
  | SingleChoiceBlock
  | MultiChoiceBlock
  | TextBlock
  | FormFieldsBlock;

export interface QuestionnairePayload {
  id?: string;
  title?: string;
  question: string;
  blocks: QuestionnaireBlock[];
  allowSkip?: boolean;
  submitLabel?: string;
  source?: ClarificationSource;
}

/** Legacy shape from SSE / ask_clarification events. */
export interface ClarificationData {
  question: string;
  options: string[];
  recommended?: string;
  allowChooseAll?: boolean;
  allowFreeform?: boolean;
  selectionMode?: 'single' | 'multiple';
  fields?: ClarificationField[];
  source?: ClarificationSource;
}

export type QuestionnaireResponseState = Record<
  string,
  string | Set<string> | Record<string, string> | null
>;

export const ALL_CHOICE_VALUE = '__all__';

export function clarificationToQuestionnaire(data: ClarificationData): QuestionnairePayload {
  const blocks: QuestionnaireBlock[] = [];

  if (data.fields?.length) {
    blocks.push({
      id: 'form',
      type: 'form_fields',
      fields: data.fields,
    });
  } else if (data.selectionMode === 'multiple' && data.options.length > 0) {
    blocks.push({
      id: 'choices',
      type: 'multi_choice',
      options: data.options.map((opt) => ({
        value: opt,
        label: opt,
        recommended: data.recommended === opt,
      })),
      allowAll: data.allowChooseAll,
    });
  } else if (data.options.length > 0) {
    blocks.push({
      id: 'choices',
      type: 'single_choice',
      options: data.options.map((opt) => ({
        value: opt,
        label: opt,
        recommended: data.recommended === opt,
      })),
      allowAll: data.allowChooseAll,
      allowFreeform: data.allowFreeform,
    });
  } else {
    blocks.push({
      id: 'text',
      type: 'text',
      placeholder: 'Type your answer…',
    });
  }

  return {
    question: data.question,
    blocks,
    allowSkip: true,
    source: data.source,
  };
}

export function buildClarificationResponse(
  payload: QuestionnairePayload,
  state: QuestionnaireResponseState,
): string | null {
  for (const block of payload.blocks) {
    const blockState = state[block.id];
    if (blockState === undefined) continue;

    if (block.type === 'single_choice') {
      const selected = blockState as string | null;
      if (!selected) return null;
      if (selected === ALL_CHOICE_VALUE) {
        return `All: ${block.options.map((o) => o.value).join(', ')}`;
      }
      return selected;
    }

    if (block.type === 'multi_choice') {
      const selected = blockState as Set<string>;
      if (selected.size === 0) return null;
      return [...selected].join(', ');
    }

    if (block.type === 'text') {
      const text = (blockState as string).trim();
      return text || null;
    }

    if (block.type === 'form_fields') {
      const values = blockState as Record<string, string>;
      const missing = block.fields.find(
        (f) => f.required !== false && !values[f.key]?.trim(),
      );
      if (missing) return null;
      return block.fields
        .map((f) => `${f.label}: ${(values[f.key] ?? '').trim()}`)
        .join('\n');
    }
  }

  return null;
}

export function initialQuestionnaireState(payload: QuestionnairePayload): QuestionnaireResponseState {
  const state: QuestionnaireResponseState = {};

  for (const block of payload.blocks) {
    if (block.type === 'single_choice') {
      const recommended = block.options.find((o) => o.recommended)?.value ?? null;
      state[block.id] = recommended;
    } else if (block.type === 'multi_choice') {
      const recommended = block.options.find((o) => o.recommended)?.value;
      state[block.id] = new Set(recommended ? [recommended] : []);
    } else if (block.type === 'text') {
      state[block.id] = '';
    } else if (block.type === 'form_fields') {
      state[block.id] = Object.fromEntries(block.fields.map((f) => [f.key, '']));
    }
  }

  return state;
}
