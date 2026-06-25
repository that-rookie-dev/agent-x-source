import type { SessionContextKind } from './session-context.js';

/** User rating for a completed assistant turn. */
export type TurnFeedbackRating = 'positive' | 'negative' | 'skipped';

export interface TurnFeedbackRecord {
  id: string;
  sessionId: string;
  messageId: string;
  contextKind: SessionContextKind;
  crewId?: string | null;
  rating: TurnFeedbackRating;
  turnSummary?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface TurnFeedbackEligibilityInput {
  role: string;
  content?: string;
  streaming?: boolean;
  isModeChange?: boolean;
  parts?: Array<{ type: string; tool?: unknown; agent?: unknown; questionnaire?: { status?: string }; crewRosterPicker?: { status?: string } }>;
  toolCalls?: unknown[];
  elapsedMs?: number;
}

const TRIVIAL_PATTERNS = [
  /^(ok|okay|sure|thanks|thank you|got it|yes|no|yep|nope)\.?$/i,
  /^(hi|hello|hey)[!.]?$/i,
];

/** Whether a completed assistant turn warrants a feedback prompt. */
export function isTurnFeedbackEligible(input: TurnFeedbackEligibilityInput): boolean {
  if (input.role !== 'assistant') return false;
  if (input.streaming) return false;
  if (input.isModeChange) return false;

  const hasPendingQuestionnaire = input.parts?.some(
    (p) => p.type === 'questionnaire' && p.questionnaire?.status === 'pending',
  );
  if (hasPendingQuestionnaire) return false;

  const hasPendingCrewPicker = input.parts?.some(
    (p) => p.type === 'crew_roster_picker' && p.crewRosterPicker?.status === 'pending',
  );
  if (hasPendingCrewPicker) return false;

  const text = (input.content ?? '').trim();
  const toolCount = (input.toolCalls?.length ?? 0)
    + (input.parts?.filter((p) => p.type === 'tool').length ?? 0);
  const subAgentCount = input.parts?.filter((p) => p.type === 'subagent').length ?? 0;
  const hasSubstantiveText = text.length >= 100;
  const hadTools = toolCount > 0;
  const hadSubAgents = subAgentCount > 0;
  const longTurn = (input.elapsedMs ?? 0) >= 8000;

  if (!hasSubstantiveText && !hadTools && !hadSubAgents && !longTurn) return false;
  if (text.length > 0 && text.length < 40 && !hadTools && !hadSubAgents) return false;
  if (text.length > 0 && TRIVIAL_PATTERNS.some((re) => re.test(text))) return false;

  return true;
}

/** Short excerpt stored with feedback for prompt context. */
export function summarizeTurnForFeedback(content: string, maxLen = 160): string {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

/** Build a compact prompt block from recent session feedback. */
export function buildTurnFeedbackContext(
  entries: TurnFeedbackRecord[],
  opts?: { maxItems?: number },
): string {
  const maxItems = opts?.maxItems ?? 6;
  const rated = entries.filter((e) => e.rating === 'positive' || e.rating === 'negative');
  if (rated.length === 0) return '';

  const recent = [...rated]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, maxItems);

  const lines = recent.map((e) => {
    const label = e.rating === 'positive' ? '👍 valued' : '👎 adjust';
    const summary = e.turnSummary?.trim() || 'assistant response';
    return `  - ${label}: ${summary}`;
  });

  return [
    '[USER_FEEDBACK]',
    'Recent user ratings on your work in this session — adapt tone, depth, and approach:',
    ...lines,
    'Prioritize patterns marked 👎. Reinforce behaviors marked 👍.',
    '[/USER_FEEDBACK]',
  ].join('\n');
}
