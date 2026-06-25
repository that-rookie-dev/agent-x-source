import { BUILTIN_AGENTS } from './agent-configs.js';

/** Tools safe in Plan mode — read/explore only; plans are rendered in chat, never written to disk. */
export const PLAN_ALLOWED_TOOL_IDS = new Set([
  // Filesystem read
  'file_read', 'file_read_batch', 'read_file', 'read', 'cat', 'file_find', 'folder_list', 'list_dir',
  'folder_tree', 'glob', 'search_files', 'file_metadata', 'file_info', 'file_diff', 'file_checksum',
  // Code intelligence read
  'glob', 'grep', 'code_search', 'code_grep', 'code_definitions', 'code_symbols',
  'code_references', 'code_analyze', 'code_typecheck',
  // Git read
  'git_status', 'git_diff', 'git_log', 'git_blame', 'git_show',
  // Web read
  'web_search', 'web_fetch', 'web_scrape', 'web_browse', 'http_get',
  // Document/data read
  'pdf_read', 'docx_read', 'xlsx_read', 'pptx_read', 'csv_parse', 'json_parse', 'json_query',
  // Memory / RAG read
  'rag_search', 'memory_search', 'memory_read', 'memory_recall',
  // Browser read-only
  'browser_open', 'browser_extract',
  // System read
  'system_info', 'system_disk', 'system_env', 'system_which', 'system_ports',
  'system_tree_size', 'system_monitor', 'security_audit', 'security_secrets',
  // Testing / build check (no artifact mutation)
  'test_run', 'test_watch', 'test_coverage', 'benchmark_run', 'build_check',
  // Database read
  'db_schema', 'db_export', 'env_read',
  // Packages read
  'pkg_audit', 'pkg_search', 'package_list', 'package_outdated',
  // AI meta (responses stay in chat)
  'ai_complete', 'ai_embed', 'ai_summarize', 'ai_classify', 'ai_extract',
  // Media read
  'image_view', 'image_ocr',
  // Crypto read
  'jwt_decode', 'secret_generate',
  // MCP read
  'mcp_list_tools', 'mcp_resource_read',
  // Containers read
  'container_list', 'container_logs', 'container_images',
  // GitHub read
  'gh_issue_list', 'gh_pr_list', 'gh_pr_view', 'gh_repo_view', 'gh_workflow_list', 'gh_release',
  // Process / clipboard read
  'process_list', 'clipboard_read',
  // Text utilities
  'text_transform', 'regex_match', 'text_diff', 'validate_schema',
  // Project detection
  'project_detect',
  // Agent meta (clarify + inspect sub-agents only)
  'ask_clarification', 'sub_agent_status', 'sub_agent_cancel', 'todo_read', 'search_crew_hub',
  // Scheduler read
  'reminder_list',
]);

/** Legacy deny list from agent-config — kept for reference and re-export. */
export const PLAN_WRITE_TOOL_IDS = new Set(
  BUILTIN_AGENTS.find((a) => a.id === 'plan')?.deniedTools ?? [],
);

/** Orchestration tools that can spawn write-capable workers — blocked in plan mode. */
export const PLAN_ORCHESTRATION_TOOL_IDS = [
  'delegate_to_subagent',
  'sub_agent_spawn',
  'delegate_to_crew',
  'spawn_crew_workers',
  'crew_message',
  'crew_response',
] as const;

/** @deprecated Prefer isToolAllowedInPlanMode / isPlanDeniedTool. Union of legacy + non-allowed tools. */
export const ALL_PLAN_DENIED_TOOLS = new Set([
  ...PLAN_WRITE_TOOL_IDS,
  ...PLAN_ORCHESTRATION_TOOL_IDS,
  // Explicit document writers (were incorrectly treated as read-only)
  'doc_markdown', 'doc_html', 'doc_json', 'doc_yaml', 'doc_diagram', 'doc_latex',
  'python_rpc', 'script_run', 'node_rpc', 'todo_write', 'todo_delete',
  'write_file', 'delete_file', 'create_dir', 'file_edit', 'apply_patch',
  'bash', 'run_command', 'execute',
  'notify_desktop', 'notify_telegram', 'notify_slack',
  'telegram_send_message', 'telegram_send_file', 'memory_store', 'clipboard_write',
  'reminder_set', 'reminder_cancel',
]);

/** True when a tool may run in Plan mode (strict allowlist). */
export function isToolAllowedInPlanMode(toolId: string): boolean {
  return PLAN_ALLOWED_TOOL_IDS.has(toolId);
}

/** True when a tool must not run in Plan mode. */
export function isPlanDeniedTool(toolId: string): boolean {
  return !isToolAllowedInPlanMode(toolId);
}

export function isWriteTool(toolId: string): boolean {
  return isPlanDeniedTool(toolId);
}

/** @deprecated Use isToolAllowedInPlanMode. Kept for existing call sites. */
export const READ_ONLY_TOOL_IDS = PLAN_ALLOWED_TOOL_IDS;

export function isReadOnlyTool(toolId: string): boolean {
  return isToolAllowedInPlanMode(toolId);
}

export type PlanGatePromptProfile = 'default' | 'crew_worker' | 'crew_private';

/** Proactive mode-escalation UI gates — Agent-X main session only (not crew private/worker). */
export function shouldUseInteractivePlanGates(
  planMode: boolean,
  delegatedWorker: boolean,
  promptProfile: PlanGatePromptProfile = 'default',
): boolean {
  if (promptProfile === 'crew_worker' || promptProfile === 'crew_private') return false;
  return planMode && !delegatedWorker;
}

const PLAN_INTENT_RE =
  /\b(plan|create a plan|make a plan|outline|roadmap|strategy|steps|milestone|break\s*down|step-by-step)\b/i;

/** Software / repo work — interactive plan approval applies. */
const CODE_TASK_SIGNALS =
  /\b(code|codebase|repo|repository|api|backend|frontend|react|deploy|docker|kubernetes|microservice|database|sql|typescript|javascript|python|refactor|migration|scaffold|npm|git|ci\/cd|endpoint|component|bug|debug|unit test|e2e|pull request|pr\b|sprint|feature|module|service|infra)\b/i;

/** Personal / lifestyle planning — answer in chat; prefer crew specialists over plan gates. */
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

export function requiresExecutionIntent(content: string): boolean {
  if (isInformationalQuery(content)) return false;
  return /\b(create|write|build|implement|fix|deploy|generate|modify|edit|delete|run|execute|install|scaffold|refactor|migrate|add|remove|update)\b/i.test(content);
}

/** True when plan mode should prompt before running a task that needs agent/write capabilities. */
export function shouldEscalateForExecution(content: string, messageClass?: string): boolean {
  if (messageClass === 'greeting' || messageClass === 'farewell' || messageClass === 'conversational') {
    return false;
  }
  return requiresExecutionIntent(content) && !requiresPlanIntent(content);
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

/** Tool-result hint when a mutating tool is blocked in plan mode. */
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

The user is in Plan Mode (read-only). The "${toolId}" tool requires Agent Mode and CANNOT be executed right now.

YOUR RESPONSE MUST:
1. ❌ NEVER claim you created/edited/deleted/executed anything. The action FAILED.
2. ❌ NEVER show fake code or fake output. It didn't actually run.
3. ✅ TELL the user the action failed and why: you're in Plan Mode and need Agent Mode
4. ✅ EXPLAIN which specific action you tried to perform and why it failed
5. ✅ SUGGEST the user click the Agent Mode button in the UI to switch modes
6. ✅ TELL them what you'll do once they switch modes

This is NOT a suggestion - it's an instruction. If you claim the tool succeeded when it failed, you're deceiving the user.

ERROR MESSAGE FROM SYSTEM: ${systemOutput}`;
}
