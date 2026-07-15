import type { UIMessage, PartEntry, SubAgent } from '../../chat/types';
import { formatProviderErrorMessage } from '@agentx/shared/browser';

export function formatWarningMessage(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : (raw instanceof Error ? raw.message : String(raw ?? ''));
  if (/api\s+error|provider|429|quota|billing|rate.?limit|unauthorized|forbidden|invalid_request/i.test(text)
    || text.trimStart().startsWith('{')) {
    return formatProviderErrorMessage(text);
  }
  const trimmed = text.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}…` : trimmed;
}

// Replace a warning if one with the same tool name (doom loop) exists, else append
export function replaceWarning(prev: string[], newMsg: string): string[] {
  const msg = formatWarningMessage(newMsg);
  if (!msg || msg === '{' || msg === '{\\' || /^[{[\s\\]+$/.test(msg)) return prev;
  // Detect doom-loop style: "toolName called Nx consecutively" or "[DOOM LOOP DETECTED] toolName"
  const doomMatch = msg.match(/(\[DOOM LOOP DETECTED\])?\s*(\S+?)\s*(?:called|repeated)/i);
  if (doomMatch) {
    const toolName = doomMatch[2];
    const idx = prev.findIndex(w => w.includes(toolName) && /(called|repeated)\s+\d+\s*x?/i.test(w));
    if (idx !== -1) {
      const copy = [...prev];
      copy[idx] = msg;
      return copy;
    }
  }
  return prev.includes(msg) ? prev : [...prev, msg];
}

/** Helper to immutably update the last assistant message (avoids React mutation anti-pattern). */
export function updateLastMessage(msgs: UIMessage[], updates: Partial<UIMessage>): UIMessage[] {
  if (msgs.length === 0) return msgs;
  const last = msgs[msgs.length - 1];
  if (last?.role !== 'assistant') return msgs;
  return [...msgs.slice(0, -1), { ...last, ...updates }];
}

export function attachChildSessionToAssistant(
  prev: UIMessage[],
  childSessionId: string,
  label: string,
  kind: 'sub_agent' | 'crew_worker',
  task = '',
): UIMessage[] {
  if (kind === 'crew_worker') return prev;
  const last = prev[prev.length - 1];
  if (last?.role !== 'assistant') return prev;
  const existing = last.subAgents ?? [];
  if (existing.some((a) => a.id === childSessionId)) return prev;
  const upgraded = existing.map((a) =>
    (a.id === 'subagent' || a.id === childSessionId)
      ? { ...a, id: childSessionId, name: label, kind, task: task || a.task, status: 'running' as const }
      : a,
  );
  const hasMatch = upgraded.some((a) => a.id === childSessionId);
  const subAgents: SubAgent[] = hasMatch
    ? upgraded
    : [...existing, { id: childSessionId, name: label, task, status: 'running' as const, kind }];
  const parts = (last.parts ?? []).map((p) =>
    p.type === 'subagent' && (p.agent?.id === 'subagent' || p.agent?.id === childSessionId)
      ? { ...p, id: childSessionId, agent: { ...p.agent!, id: childSessionId, name: label, kind, task: task || p.agent!.task, status: 'running' as const } }
      : p,
  );
  const hasPart = parts.some((p) => p.type === 'subagent' && p.agent?.id === childSessionId);
  const nextParts: PartEntry[] = hasPart
    ? parts
    : [...(last.parts ?? []), { type: 'subagent' as const, id: childSessionId, agent: { id: childSessionId, name: label, task, status: 'running' as const, kind } }];
  return updateLastMessage(prev, { subAgents, parts: nextParts });
}

export function isTimeoutWarning(msg: string): boolean {
  return /timeout|timed out|aborted due to timeout/i.test(msg);
}

export function clearTimeoutWarnings(prev: string[]): string[] {
  return prev.filter(w => !isTimeoutWarning(w));
}
