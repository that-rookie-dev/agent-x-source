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
  if (toolId.startsWith('integration__')) {
    return planMode ? isToolAllowedInPlanMode(toolId) : true;
  }
  if (!COMPACT_TOOL_IDS.has(toolId)) return false;
  if (planMode) return isToolAllowedInPlanMode(toolId);
  return true;
}

export interface CompletionMessageLike {
  role: string;
  content: string;
  /** Present on tool-result messages that must round-trip through provider normalization. */
  toolCallId?: string;
}

/**
 * Gemini rejects system messages after the first user/assistant turn.
 * Merge leading system messages into one, and fold mid-conversation system notes into user messages.
 */
export function normalizeAiSdkMessages(
  messages: CompletionMessageLike[],
): CompletionMessageLike[] {
  const result: CompletionMessageLike[] = [];
  const leadingSystem: string[] = [];
  let seenNonSystem = false;

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (!seenNonSystem) {
        if (msg.content.trim()) leadingSystem.push(msg.content);
        continue;
      }
      result.push({
        role: 'user',
        content: `[SYSTEM NOTE]\n${msg.content}\n[/SYSTEM NOTE]`,
      });
      continue;
    }

    seenNonSystem = true;
    result.push({ role: msg.role, content: msg.content, ...(msg.toolCallId ? { toolCallId: msg.toolCallId } : {}) });
  }

  if (leadingSystem.length > 0) {
    result.unshift({ role: 'system', content: leadingSystem.join('\n\n') });
  }

  return result;
}

/** Apply Gemini-specific message normalization only when the active provider requires it. */
export function normalizeAiSdkMessagesForProvider(
  messages: CompletionMessageLike[],
  providerId?: string,
): CompletionMessageLike[] {
  if (providerId !== 'google') {
    return messages.map((m) => ({ role: m.role, content: m.content, ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}) }));
  }
  return normalizeAiSdkMessages(messages);
}

/** Compact path: one system baseline + recent turns only (drops system diffs / old history). */
export function buildCompletionMessages(
  messages: CompletionMessageLike[],
  compact: boolean,
  maxRecentTurns = 3,
  providerId?: string,
): CompletionMessageLike[] {
  let built: CompletionMessageLike[];
  if (!compact) {
    built = messages.map((m) => ({ role: m.role, content: m.content }));
  } else {
    const systemBaseline = messages.find((m) => m.role === 'system')?.content ?? '';
    const nonSystem = messages.filter((m) => m.role !== 'system');
    const recent = nonSystem.slice(-maxRecentTurns * 2);

    built = [];
    if (systemBaseline.trim()) {
      built.push({ role: 'system', content: systemBaseline });
    }
    for (const m of recent) {
      built.push({ role: m.role, content: m.content });
    }
  }

  return normalizeAiSdkMessagesForProvider(built, providerId);
}

export const COMPACT_MEMORY_MAX_CHARS = 2_000;
export const FULL_MEMORY_MAX_CHARS = 8_000;
