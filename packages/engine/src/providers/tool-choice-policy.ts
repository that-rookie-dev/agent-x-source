/**
 * Policy for when the runtime may send a forced / named tool selection.
 *
 * Some model stacks reject forced tool selection while extended reasoning is
 * active (or always, for reasoner-default endpoints). Prefer capability signals,
 * prior unsupported responses, and prompt-level tool guidance over hard-coded
 * model inventories.
 */

export type ForcedToolChoicePolicyInput = {
  /** Turn policy wants a specific tool on the first step. */
  policyWantsForce: boolean;
  /** Active reasoning effort from config (`none` / empty = off). */
  reasoningEffort?: string | null;
  /** True after this model key previously rejected forced tool selection. */
  previouslyUnsupported?: boolean;
  /**
   * Optional catalog hint. When explicitly false, never force.
   * When undefined, other signals decide.
   */
  supportsForcedToolChoice?: boolean | null;
};

function normalizeEffort(raw: string | null | undefined): string {
  return String(raw ?? 'none').trim().toLowerCase();
}

function isReasoningEffortActive(raw: string | null | undefined): boolean {
  const effort = normalizeEffort(raw);
  return effort !== '' && effort !== 'none' && effort !== 'off' && effort !== 'disabled' && effort !== 'false';
}

/** Whether prepareStep / streamText may send a named or required tool choice. */
export function shouldForceNamedToolChoice(input: ForcedToolChoicePolicyInput): boolean {
  if (!input.policyWantsForce) return false;
  if (input.supportsForcedToolChoice === false) return false;
  if (input.previouslyUnsupported) return false;
  if (isReasoningEffortActive(input.reasoningEffort)) return false;
  return true;
}

/**
 * True when a provider error indicates forced/named tool selection is invalid
 * for the current request (common on reasoning-enabled endpoints).
 */
export function isUnsupportedToolChoiceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (!/tool[_ ]?choice/i.test(msg)) return false;
  return /not support|unsupported|invalid|does not allow|cannot use/i.test(msg);
}

/** Stable key for remembering per-model tool-choice limits within a process. */
export function toolChoiceModelKey(providerId: string | undefined, modelId: string | undefined): string {
  return `${providerId || 'unknown'}::${modelId || 'unknown'}`;
}
