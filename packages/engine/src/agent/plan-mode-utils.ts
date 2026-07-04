import { BUILTIN_AGENTS } from './agent-configs.js';
import {
  parseIntegrationToolId,
  isIntegrationEditOrDeleteTool,
} from '../integrations/action-classifier.js';
import { getIntegrationProvider } from '../integrations/catalog/index.js';

/**
 * Plan mode blocks edits and deletes only. Reads, new file creation, shell/scripts,
 * notifications, and automation scheduling all work in Plan mode.
 */
export const PLAN_DENIED_TOOL_IDS = new Set([
  // Filesystem edit/delete
  'file_delete', 'delete_file', 'folder_delete', 'folder_move', 'file_patch',
  'file_edit', 'apply_patch', 'code_replace', 'code_insert', 'code_range',
  'json_set',
  // Agent meta delete
  'todo_delete',
  // Process/package removal
  'process_kill', 'package_remove',
  // Destructive git operations
  'git_reset', 'git_rebase', 'git_merge', 'git_stash',
]);

/** Orchestration tools that spawn unrestricted workers — blocked in plan mode. */
export const PLAN_ORCHESTRATION_TOOL_IDS = [
  'delegate_to_subagent',
  'sub_agent_spawn',
  'delegate_to_crew',
  'spawn_crew_workers',
  'crew_message',
  'crew_response',
] as const;

for (const id of PLAN_ORCHESTRATION_TOOL_IDS) {
  PLAN_DENIED_TOOL_IDS.add(id);
}

/** @deprecated Use PLAN_DENIED_TOOL_IDS. Kept for tests and legacy references. */
export const ALL_PLAN_DENIED_TOOLS = new Set(PLAN_DENIED_TOOL_IDS);

/** Legacy deny list from agent-config — kept for reference. */
export const PLAN_WRITE_TOOL_IDS = new Set(
  BUILTIN_AGENTS.find((a) => a.id === 'plan')?.deniedTools ?? [],
);

/** True when a tool may run in Plan mode (deny edits/deletes only). */
export function isToolAllowedInPlanMode(toolId: string): boolean {
  if (PLAN_DENIED_TOOL_IDS.has(toolId)) return false;
  const parsed = parseIntegrationToolId(toolId);
  if (parsed) {
    const provider = getIntegrationProvider(parsed.providerId);
    return !isIntegrationEditOrDeleteTool(parsed.toolName, provider);
  }
  return true;
}

/** True when a tool must not run in Plan mode (edits/deletes). */
export function isPlanDeniedTool(toolId: string): boolean {
  return !isToolAllowedInPlanMode(toolId);
}

/** True when the tool edits or deletes existing state (requires Agent/Hyperdrive). */
export function isWriteTool(toolId: string): boolean {
  return isPlanDeniedTool(toolId);
}

/** @deprecated Misleading name — use isToolAllowedInPlanMode. True for non-edit/delete tools. */
export function isReadOnlyTool(toolId: string): boolean {
  return isToolAllowedInPlanMode(toolId);
}

export type PlanGatePromptProfile = 'default' | 'crew_worker' | 'crew_private';

/** Interactive mode-escalation UI is disabled — tool gate handles edit/delete blocks. */
export function shouldUseInteractivePlanGates(
  _planMode: boolean,
  _delegatedWorker: boolean,
  _promptProfile: PlanGatePromptProfile = 'default',
): boolean {
  return false;
}

const PLAN_INTENT_RE =
  /\b(plan|create a plan|make a plan|outline|roadmap|strategy|steps|milestone|break\s*down|step-by-step)\b/i;

const CODE_TASK_SIGNALS =
  /\b(code|codebase|repo|repository|api|backend|frontend|react|deploy|docker|kubernetes|microservice|database|sql|typescript|javascript|python|refactor|migration|scaffold|npm|git|ci\/cd|endpoint|component|bug|debug|unit test|e2e|pull request|pr\b|sprint|feature|module|service|infra)\b/i;

const CONVERSATIONAL_PLANNING_RE =
  /\b(vacation|itinerary|trip|travel|holiday|tourism|hotel|flight|beach|honeymoon|wedding|party|meal plan|diet plan|workout plan|study plan|lesson plan|reading list|gift list|packing list|road trip|weekend getaway|family trip|newborn|new born|baby shower|birthday party)\b/i;

export function isConversationalPlanningRequest(content: string): boolean {
  const lower = content.toLowerCase().trim();
  if (!CONVERSATIONAL_PLANNING_RE.test(lower)) return false;
  return !CODE_TASK_SIGNALS.test(lower);
}

export function requiresPlanIntent(content: string): boolean {
  if (isConversationalPlanningRequest(content)) return false;
  return PLAN_INTENT_RE.test(content);
}

const RESEARCH_QUESTION_RE =
  /\b(which|what|who|where|when|how|why|best|recommend|compare|versus|vs\.?|difference|suggest|opinion|advice|should i|options?|alternatives?)\b/i;

export function isInformationalQuery(content: string): boolean {
  const lower = content.toLowerCase().trim();
  const isQuestion = /\?$/.test(lower) || RESEARCH_QUESTION_RE.test(lower);
  if (isQuestion && RESEARCH_QUESTION_RE.test(lower)) return true;
  if (/\b(which|what)\b/i.test(lower) && /\b(best|recommend|compare|options?)\b/i.test(lower)) return true;
  return false;
}

const EDIT_DELETE_INTENT_RE =
  /\b(edit|modify|update|delete|remove|rename|move|patch|overwrite|replace|refactor)\b/i;

export function requiresExecutionIntent(content: string): boolean {
  if (isInformationalQuery(content)) return false;
  return EDIT_DELETE_INTENT_RE.test(content);
}

/** Disabled — Plan mode allows create/execute; only edit/delete tools are gated. */
export function shouldEscalateForExecution(_content: string, _messageClass?: string): boolean {
  return false;
}

/** @deprecated Interactive plan approval removed — plans are markdown in the completion loop. */
export function shouldGeneratePlan(content: string, messageClass?: string): boolean {
  if (isConversationalPlanningRequest(content)) return false;
  if (requiresPlanIntent(content)) return true;
  if (messageClass === 'task' && /\b(plan|planning|roadmap|outline)\b/i.test(content)) {
    return !isConversationalPlanningRequest(content);
  }
  return false;
}

/** Tool-result hint when an edit/delete tool is blocked in plan mode. */
export function buildPlanModeRestrictedToolHint(
  toolId: string,
  systemOutput: string,
  promptProfile: PlanGatePromptProfile = 'default',
): string {
  if (promptProfile === 'crew_private') {
    return [
      `The "${toolId}" tool is not available in this private chat turn.`,
      systemOutput,
      'Do NOT ask the user to switch to Agent mode or open any approval UI.',
      'Continue the conversation: deliver your complete answer as markdown in chat.',
      'Only mention filesystem tools if they explicitly asked to modify files on their machine.',
    ].join('\n');
  }

  return `🚨 CRITICAL RESTRICTION 🚨

The "${toolId}" tool FAILED with error: MODE_RESTRICTED

The user is in Plan Mode. The "${toolId}" tool edits or deletes existing resources and requires Agent Mode or Hyperdrive.

YOUR RESPONSE MUST:
1. ❌ NEVER claim you edited/deleted anything. The action FAILED.
2. ❌ NEVER show fake code or fake output. It didn't actually run.
3. ✅ TELL the user this specific edit/delete requires Agent Mode or Hyperdrive
4. ✅ NOTE that reads, new file creation, scripts, web search, and scheduling still work in Plan mode
5. ✅ SUGGEST switching to Agent mode only for this edit/delete action

ERROR MESSAGE FROM SYSTEM: ${systemOutput}`;
}
