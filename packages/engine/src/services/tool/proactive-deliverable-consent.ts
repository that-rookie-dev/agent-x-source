/** Deliverable tools that must not run proactively without user confirmation. */
export const PROACTIVE_DELIVERABLE_TOOLS = new Set([
  'save_to_article',
  'gen_markdown',
  'gen_html',
  'pdf_create',
  'docx_create',
  'xlsx_create',
  'pptx_create',
  'csv_create',
  'file_write',
  'write_file',
  'file_edit',
  'edit_file',
  'apply_patch',
]);

const SESSION_WAIVER_RE = /\b(no need to ask(?: me)?(?: for)? permission|don'?t ask(?: me)?(?: for)? permission|do not ask(?: me)?(?: for)? permission|don'?t ask again|do not ask again|stop asking(?: me)?|just (?:carry on|continue|proceed|do it)|carry on without asking|skip (?:the )?permission|auto[- ]?approve|you (?:have|got) (?:my )?permission)\b/i;

const EXPLICIT_DELIVERABLE_REQUEST_RE = /\b(save|export|write|create|generate|make|store|persist)\b[\s\S]{0,80}\b(article|articles|markdown|md|pdf|docx|xlsx|pptx|csv|document|report|file|itinerary|plan|deliverable)\b|\b(save|export)\s+(this|it|that|to)\b|\bjust save (?:it|this|that)\b|\bsave (?:it|this|that) into\b|\bwrite (?:it|this|that) (?:to|as|into)\b/i;

const AFFIRMATIVE_ONLY_RE = /^(yes|yeah|yep|yup|sure|ok|okay|alright|affirmative)([,!.]?\s+(please|please do|please save(?: it)?|save it|save this|do it|go ahead|proceed|just (?:do|save) it))*[!.?]*\s*$/i;

const AFFIRMATIVE_WITH_ACTION_RE = /^(yes|yeah|yep|yup|sure|ok|okay|alright)[,!.\s].{0,120}\b(save|write|export|create|do it|go ahead|proceed|just save|please)\b/i;

const ASSISTANT_OFFERED_ACTION_RE = /should i |shall i |want me to |may i |can i (?:save|write|create|proceed|go ahead)|save (?:this|it|that) (?:to|as)|i(?:'ll| will) (?:save|draft|prepare)|articles sidebar|save (?:it|this) to/i;

export function isProactiveDeliverableTool(toolId: string): boolean {
  return PROACTIVE_DELIVERABLE_TOOLS.has(toolId);
}

/** Session-level waiver for low-risk proactive deliverable consent. */
export function detectsSessionProactiveConsentWaiver(text: string): boolean {
  return SESSION_WAIVER_RE.test(text.trim());
}

/** True when the current user turn explicitly asked for a save/create deliverable. */
export function detectsExplicitDeliverableRequest(text: string): boolean {
  return EXPLICIT_DELIVERABLE_REQUEST_RE.test(text.trim());
}

/** Short spoken/typed yes after the agent offered to act. */
export function detectsAffirmativeActionConsent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (AFFIRMATIVE_ONLY_RE.test(t)) return true;
  return t.length <= 180 && AFFIRMATIVE_WITH_ACTION_RE.test(t);
}

/** Last assistant turn offered to save/create or asked for permission to act. */
export function lastAssistantOfferedAction(text: string): boolean {
  return ASSISTANT_OFFERED_ACTION_RE.test(text);
}

export interface ActionConsentTarget {
  setSkipLowRiskProactiveConsent(enabled: boolean): void;
  grantToolConsent(toolId: string): void;
  getRegistry?(): { list(): Array<{ id: string; name?: string }> };
}

export interface InstructedActionConsentResult {
  granted: string[];
  waived: boolean;
  explicit: boolean;
  affirmative: boolean;
}

/**
 * Record that the user instructed the agent to act (voice or text).
 * Grants per-turn consent for deliverable tools so permission does not
 * bounce the same "shall I save?" loop after an explicit yes.
 */
export function applyInstructedActionConsent(
  target: ActionConsentTarget,
  userText: string,
  lastAssistantText?: string,
): InstructedActionConsentResult {
  const waived = detectsSessionProactiveConsentWaiver(userText);
  if (waived) {
    target.setSkipLowRiskProactiveConsent(true);
  }

  const explicit = detectsExplicitDeliverableRequest(userText);
  const affirmative = detectsAffirmativeActionConsent(userText);
  const offered = lastAssistantText ? lastAssistantOfferedAction(lastAssistantText) : false;
  const grantDeliverables = explicit || waived || (affirmative && offered);

  const granted = new Set<string>();
  if (grantDeliverables) {
    for (const toolId of PROACTIVE_DELIVERABLE_TOOLS) {
      target.grantToolConsent(toolId);
      granted.add(toolId);
    }
  }

  if ((affirmative && offered && lastAssistantText) || explicit) {
    const hay = `${lastAssistantText ?? ''} ${userText}`.toLowerCase();
    const registry = target.getRegistry?.();
    if (registry) {
      for (const tool of registry.list()) {
        const id = tool.id ?? '';
        if (!id) continue;
        if (hay.includes(id.toLowerCase()) || hay.includes(id.replace(/_/g, ' '))) {
          target.grantToolConsent(id);
          granted.add(id);
        }
      }
    }
  }

  return { granted: [...granted], waived, explicit, affirmative };
}

export function proactiveDeliverableConsentInstruction(toolId: string): string {
  const label = toolId.replace(/_/g, ' ');
  return (
    `Do not call ${toolId} yet. Ask the user one short plain-text question confirming whether they want you to ${label} now, then STOP this turn and wait for their reply. `
    + 'Do not use ask_clarification for this confirmation. If they say yes / proceed / save it, call the tool on the next turn. '
    + 'After they confirm, call the tool immediately — do not ask again.'
  );
}
