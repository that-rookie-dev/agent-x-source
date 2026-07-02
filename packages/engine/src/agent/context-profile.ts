import type { ProviderId } from '@agentx/shared';
import { isToolAllowedInPlanMode } from './plan-mode-utils.js';

const LOCAL_PROVIDERS = new Set<ProviderId>(['ollama', 'lmstudio']);

/** Local models at or above this size keep the full cloud-style context pipeline. */
const LARGE_LOCAL_MODEL =
  /\b(7b|8b|9b|11b|12b|13b|14b|20b|27b|32b|70b|72b|405b|:7b|:8b|:9b|:11b|:12b|:13b|:14b|:32b|:70b)\b/i;

/**
 * Automatically enable compact context for small/local models.
 * Cloud providers always return false — no user-facing tier selection.
 */
export function isCompactContextProfile(
  providerId: string,
  modelId: string,
  contextWindow?: number,
): boolean {
  if (!LOCAL_PROVIDERS.has(providerId as ProviderId)) return false;
  const model = modelId.toLowerCase();
  if (LARGE_LOCAL_MODEL.test(model)) return false;
  if (contextWindow != null && contextWindow > 16_384) return false;
  return true;
}

/** Core tools exposed to compact-context models (plan mode still filters writes). */
export const COMPACT_TOOL_IDS = new Set([
  'file_read',
  'read_file',
  'read',
  'file_write',
  'write_file',
  'glob',
  'grep',
  'code_grep',
  'code_search',
  'list_dir',
  'folder_list',
  'shell_exec',
  'bash',
  'file_patch',
  'apply_patch',
  'memory_fabric_search',
  'rag_search',
  'ask_clarification',
  'web_search',
  'web_fetch',
  'todo_read',
  'todo_write',
]);

export function isCompactToolAllowed(toolId: string, planMode: boolean): boolean {
  if (!COMPACT_TOOL_IDS.has(toolId)) return false;
  if (planMode) return isToolAllowedInPlanMode(toolId);
  return true;
}

export interface CompletionMessageLike {
  role: string;
  content: string;
}

/** Compact path: one system baseline + recent turns only (drops system diffs / old history). */
export function buildCompletionMessages(
  messages: CompletionMessageLike[],
  compact: boolean,
  maxRecentTurns = 3,
): CompletionMessageLike[] {
  if (!compact) {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  const systemBaseline = messages.find((m) => m.role === 'system')?.content ?? '';
  const nonSystem = messages.filter((m) => m.role !== 'system');
  const recent = nonSystem.slice(-maxRecentTurns * 2);

  const result: CompletionMessageLike[] = [];
  if (systemBaseline.trim()) {
    result.push({ role: 'system', content: systemBaseline });
  }
  for (const m of recent) {
    result.push({ role: m.role, content: m.content });
  }
  return result;
}

export const COMPACT_MEMORY_MAX_CHARS = 2_000;
export const FULL_MEMORY_MAX_CHARS = 8_000;
