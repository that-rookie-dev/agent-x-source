import type { UIMessage, PartEntry, SubAgent } from '../../chat/types';

export function updateLastMessage(prev: UIMessage[], patch: Partial<UIMessage>): UIMessage[] {
  if (prev.length === 0) return prev;
  const last = prev[prev.length - 1]!;
  return [...prev.slice(0, -1), { ...last, ...patch }];
}

export function replaceWarning(prev: string[], next: string): string[] {
  const without = prev.filter((w) => w !== next);
  return [...without, next];
}

function tasksLikelyMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const aSlice = left.slice(0, 80);
  const bSlice = right.slice(0, 80);
  return aSlice.includes(bSlice) || bSlice.includes(aSlice);
}

function bindAgent(a: SubAgent, childSessionId: string, label: string, kind: 'sub_agent' | 'crew_worker', task: string): SubAgent {
  return {
    ...a,
    id: childSessionId,
    name: label || a.name,
    kind,
    task: task || a.task,
    status: a.status === 'done' || a.status === 'error' ? a.status : 'running',
    sessionBound: true,
  };
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
  if (existing.some((a) => a.id === childSessionId)) {
    // Refresh label/task on an already-attached card.
    const subAgents = existing.map((a) =>
      a.id === childSessionId ? bindAgent(a, childSessionId, label, kind, task) : a,
    );
    const parts = (last.parts ?? []).map((p) =>
      p.type === 'subagent' && p.agent?.id === childSessionId
        ? { ...p, agent: bindAgent(p.agent!, childSessionId, label, kind, task) }
        : p,
    );
    return updateLastMessage(prev, { subAgents, parts });
  }

  // Upgrade a running placeholder to the real child session id.
  // Prefer task match; never remap an already-bound card (parallel spawn safety).
  const candidates = existing
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => a.status === 'running' && a.kind !== 'crew_worker' && a.id !== childSessionId && !a.sessionBound);

  let matchIndex = -1;
  if (task) {
    matchIndex = candidates.findIndex(({ a }) => tasksLikelyMatch(a.task || '', task));
  }
  if (matchIndex < 0 && candidates.length === 1) {
    matchIndex = 0;
  }

  if (matchIndex < 0) {
    // Ambiguous parallel spawn or no placeholder — append a new card.
    const agent: SubAgent = { id: childSessionId, name: label, task, status: 'running', kind, sessionBound: true };
    const subAgents: SubAgent[] = [...existing, agent];
    const nextParts: PartEntry[] = [
      ...(last.parts ?? []),
      { type: 'subagent', id: childSessionId, agent },
    ];
    return updateLastMessage(prev, { subAgents, parts: nextParts });
  }

  const targetId = candidates[matchIndex]!.a.id;
  const subAgents = existing.map((a) =>
    a.id === targetId ? bindAgent(a, childSessionId, label, kind, task) : a,
  );
  const parts = (last.parts ?? []).map((p) =>
    p.type === 'subagent' && p.agent?.id === targetId
      ? { ...p, id: childSessionId, agent: bindAgent(p.agent, childSessionId, label, kind, task) }
      : p,
  );
  const hasPart = parts.some((p) => p.type === 'subagent' && p.agent?.id === childSessionId);
  const nextParts: PartEntry[] = hasPart
    ? parts
    : [...parts, { type: 'subagent' as const, id: childSessionId, agent: { id: childSessionId, name: label, task, status: 'running' as const, kind, sessionBound: true } }];
  return updateLastMessage(prev, { subAgents, parts: nextParts });
}

export function isTimeoutWarning(msg: string): boolean {
  return /timeout|timed out|aborted due to timeout/i.test(msg);
}

export function clearTimeoutWarnings(prev: string[]): string[] {
  return prev.filter(w => !isTimeoutWarning(w));
}
