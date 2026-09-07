import type { CategoryResult } from '../prompt/CategoryDetector.js';

/**
 * Router (design doc Section 4.1): decides whether a coding turn takes the fast
 * path (trivial fixes the LLM can handle inline with tools) or the full
 * Engineering Crew pipeline (Architect → Coder ⇄ Verifier → Reviewer).
 *
 * The decision is intentionally conservative — when in doubt, prefer the fast
 * path, because the Engineering Crew pipeline has higher latency and token cost.
 * It should only engage for *substantial* software-engineering work where the
 * plan → implement → independently-verify → review structure provides genuine
 * value over a single LLM turn.
 */

// Indicators that the user is asking for a *substantial* build — not a quick
// edit, debug, refactor, or code-review request.
const SUBSTANTIAL_SIGNALS = [
  /\bbuild\s+(?:a|an|the)\b/i,
  /\bcreate\s+(?:a|an|the|new)\b.*\b(?:app|application|project|service|api|server|backend|frontend|cli|library|sdk|package|module|system|pipeline|workflow|microservice)\b/i,
  /\bimplement\s+(?:a|an|the|new)\b.*\b(?:app|application|project|service|api|server|backend|frontend|cli|library|sdk|package|module|system|pipeline|workflow|microservice|feature)\b/i,
  /\bdevelop\s+(?:a|an|the|new)\b/i,
  /\bscaffold\s+(?:a|an|the|new)\b/i,
  /\bset\s+up\s+(?:a|an|the|new)\b.*\b(?:app|application|project|service|api|server|backend|frontend|cli|library|sdk|package|module|system|pipeline|workflow|microservice)\b/i,
  /\bgenerate\s+(?:a|an|the|new)\b.*\b(?:app|application|project|service|api|server|backend|frontend|cli|library|sdk|package|module|system)\b/i,
  /\bfrom\s+scratch\b/i,
  /\bfull[\s-]?stack\b/i,
  /\bend[\s-]?to[\s-]?end\b/i,
  /\bproduction[\s-]?ready\b/i,
  /\bproperly\s+functional\b/i,
  /\bwhole\s+project\b/i,
  /\bcomplete\s+(?:app|application|project|service|api|server|backend|frontend|cli|library|sdk|package|module|system)\b/i,
];

// Indicators that the user is asking for something *trivial* — even if the
// category is 'coding', these should stay on the fast path.
const TRIVIAL_SIGNALS = [
  /\bfix\s+(?:this|the|a)\s+(?:typo|bug|error|warning|lint|import)\b/i,
  /\brename\b/i,
  /\badd\s+(?:a\s+)?(?:console\s+log|print|comment|log\s+statement)\b/i,
  /\b(?:quick|small|minor|tiny|simple)\s+(?:fix|change|edit|update|tweak|patch)\b/i,
  /\b(?:what|why|how|explain|show|describe|tell\s+me)\b/i,
  /\b(?:review|analyze|inspect|audit)\b/i,
  /\b(?:refactor|clean\s+up|simplify|optimize)\s+(?:this|the|a)\s+(?:function|method|class|file|component)\b/i,
  /\b(?:convert|translate|port)\s+(?:this|the|a)\s+(?:function|method|class|file|snippet|code)\b/i,
  /\bdebug\s+(?:this|the|a)\s+(?:error|issue|problem|crash|exception)\b/i,
  /\bwrite\s+(?:a\s+)?(?:unit\s+test|test\s+case|test\s+for)\b/i,
];

export interface RouterDecision {
  useEngineeringCrew: boolean;
  reason: string;
  /** If true, the crew should resume a prior run rather than starting fresh. */
  resumePriorRun?: boolean;
  /** The task ID of the prior run to resume, if known. */
  priorTaskId?: string;
}

export interface RouterContext {
  /** The session ID — used to look up prior crew runs. */
  sessionId?: string;
  /** Whether a prior Engineering Crew run exists for this session (any status). */
  hasPriorRun?: boolean;
  /** Whether a prior run is incomplete (in_progress/blocked/timed_out/failed). */
  hasIncompleteRun?: boolean;
  /** The task ID of the most recent incomplete prior run, if any. */
  priorTaskId?: string;
  /** The objective of the most recent prior run, if any. */
  priorObjective?: string;
}

/**
 * Optional LLM-based intent classifier for ambiguous routing decisions (#10).
 * When the regex/heuristic paths don't produce a clear decision, this function
 * (if provided) is called to classify whether the user's message is a substantial
 * software-engineering request that warrants the full crew pipeline.
 *
 * The function should be lightweight (short prompt, small model) to minimize latency.
 * Returns true if the Engineering Crew should be used, false for the fast path.
 */
export type LLMIntentClassifier = (userMessage: string, priorObjective?: string) => Promise<boolean>;

/**
 * Decide whether to route a coding turn through the Engineering Crew pipeline.
 *
 * Two routing paths:
 * 1. **Fresh start**: The user's message matches a substantial-build signal
 *    (e.g. "build a...", "create a...") and no prior incomplete run exists.
 * 2. **Resume**: A prior incomplete crew run exists for this session, and the
 *    user's message is a coding-category turn that semantically relates to
 *    continuing, refining, or fixing the prior work — even if they don't use
 *    the literal word "continue". The LLM inside the crew will use the full
 *    session context to understand what's being asked.
 *
 * @param content The user's message text.
 * @param category The detected category from `CategoryDetector`.
 * @param ctx Optional session context for resume detection.
 * @returns A decision with a human-readable reason.
 */
export async function routeCodingTask(
  content: string,
  category: CategoryResult | null,
  ctx?: RouterContext,
  llmClassify?: LLMIntentClassifier,
): Promise<RouterDecision> {
  // Only coding-category turns are candidates.
  if (!category || (category.primary !== 'coding' && category.primary !== 'edge')) {
    return { useEngineeringCrew: false, reason: 'Not a coding turn' };
  }

  const text = content.trim();

  // ─── Resume path: prior incomplete run exists ───
  // If there's an incomplete crew run for this session, route to the crew so it
  // can resume. The crew's LLM will receive the full session context (conversation
  // history + prior plan state) and understand what "continue" means semantically —
  // whether the user says "continue", "now add tests", "fix the failing endpoint",
  // "the build is broken", or anything else that relates to the prior work.
  if (ctx?.hasIncompleteRun && ctx.priorTaskId) {
    // Don't resume for clearly trivial requests that have nothing to do with the build
    for (const pattern of TRIVIAL_SIGNALS) {
      if (pattern.test(text)) {
        return { useEngineeringCrew: false, reason: `Trivial coding request matched: ${pattern.source}` };
      }
    }
    return {
      useEngineeringCrew: true,
      reason: `Resuming incomplete crew run ${ctx.priorTaskId} (prior objective: "${(ctx.priorObjective ?? '').slice(0, 80)}")`,
      resumePriorRun: true,
      priorTaskId: ctx.priorTaskId,
    };
  }

  // ─── Fresh start path ───

  // Trivial signals short-circuit to the fast path.
  for (const pattern of TRIVIAL_SIGNALS) {
    if (pattern.test(text)) {
      return { useEngineeringCrew: false, reason: `Trivial coding request matched: ${pattern.source}` };
    }
  }

  // Substantial signals trigger the Engineering Crew.
  for (const pattern of SUBSTANTIAL_SIGNALS) {
    if (pattern.test(text)) {
      return { useEngineeringCrew: true, reason: `Substantial engineering request matched: ${pattern.source}` };
    }
  }

  // Default: for coding turns that don't clearly match either pattern, use a
  // length/complexity heuristic. Long, multi-sentence coding requests are more
  // likely to be substantial.
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).length;
  if (sentences.length >= 3 && words >= 40) {
    return { useEngineeringCrew: true, reason: `Multi-sentence coding request (${words} words, ${sentences.length} sentences)` };
  }

  // #10: LLM-based intent detection for ambiguous cases.
  // If an LLM classifier is provided, use it for the final decision on short/ambiguous
  // coding messages. This catches cases like "the API isn't working right" or "add auth
  // to the user endpoint" that don't match substantial signals but are real engineering work.
  if (llmClassify) {
    try {
      const shouldUseCrew = await llmClassify(text, ctx?.priorObjective);
      return {
        useEngineeringCrew: shouldUseCrew,
        reason: shouldUseCrew
          ? 'LLM intent classifier: substantial engineering request'
          : 'LLM intent classifier: trivial/fast-path request',
      };
    } catch {
      // LLM classification failed — fall through to default
    }
  }

  return { useEngineeringCrew: false, reason: 'Default fast path for coding turn' };
}
