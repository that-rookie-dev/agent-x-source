import type { ChatMessage, SessionInfo } from '../api';
import { mapRestoreHistoryMessage } from './utils';
import type { UIMessage } from './types';
import { appendStreamText, repairStreamTextGlitches, type TurnFeedbackRating } from '@agentx/shared/browser';
import { sessionHostCrewDisplay } from '../utils/crew-display';

/** Initial messages loaded per role (user + assistant) on session open. */
export const CHAT_INITIAL_MESSAGES_PER_ROLE = 5;
/** Super-session (Agent-X core) UI window — 25 per role ≈ 50 visible messages. */
export const CORE_SESSION_MESSAGES_PER_ROLE = 25;

export interface SessionShellPatch {
  crewPrivate: boolean;
  privateHost: { name: string; callsign: string; title?: string } | null;
  privateHostCrewId: string | null;
  bypassPermissions?: boolean;
  title: string;
}

export function buildSessionShellPatch(session: SessionInfo): SessionShellPatch {
  const kind = session.contextKind ?? 'agent_x';
  const crewPrivate = kind === 'crew_private';
  const title = session.title ?? `Session ${session.id.slice(0, 8)}`;
  if (kind === 'agent_x_core') {
    return {
      crewPrivate: false,
      privateHost: null,
      privateHostCrewId: null,
      bypassPermissions: session.bypassPermissions,
      title,
    };
  }
  if (!crewPrivate) {
    return {
      crewPrivate: false,
      privateHost: null,
      privateHostCrewId: null,
      bypassPermissions: session.bypassPermissions,
      title,
    };
  }
  const { displayName, displayCallsign } = sessionHostCrewDisplay(session);
  return {
    crewPrivate: true,
    privateHost: {
      name: displayName,
      callsign: displayCallsign,
      title: session.hostCrewTitle,
    },
    privateHostCrewId: session.hostCrewId ?? null,
    bypassPermissions: session.bypassPermissions,
    title,
  };
}

export function applyTurnFeedbackRows(
  msgs: UIMessage[],
  rows?: Array<Record<string, unknown>>,
): UIMessage[] {
  if (!rows?.length) return msgs;
  const byMessage = new Map<string, TurnFeedbackRating>();
  for (const row of rows) {
    const messageId = String(row['message_id'] ?? row['messageId'] ?? '');
    const rating = String(row['rating'] ?? '') as TurnFeedbackRating;
    if (messageId && (rating === 'positive' || rating === 'negative' || rating === 'skipped')) {
      byMessage.set(messageId, rating);
    }
  }
  if (byMessage.size === 0) return msgs;
  return msgs.map((m) => {
    const rating = byMessage.get(m.id);
    return rating ? { ...m, turnFeedback: { rating } } : m;
  });
}

export function mapHistoryToUiMessages(historyMsgs: ChatMessage[]): UIMessage[] {
  const visible = historyMsgs.filter((m) => m.role !== 'part' && m.role !== 'system');
  return visible.map((m) => {
    const restored = mapRestoreHistoryMessage(m as unknown as Record<string, unknown>);
    const restoredSubs = (restored.subAgents as ChatMessage['subAgents'] | undefined)
      ?? m.subAgents;
    const subAgents = restoredSubs?.map((sa) => ({
      ...sa,
      // History rows are completed turns — coerce leftover running cards to done.
      status: sa.status === 'error' ? 'error' as const : 'done' as const,
    }));
    const parts = Array.isArray(restored.parts)
      ? (restored.parts as NonNullable<UIMessage['parts']>).map((p) => (
        p.type === 'subagent' && p.agent
          ? {
            ...p,
            agent: {
              ...p.agent,
              status: p.agent.status === 'error' ? 'error' as const : 'done' as const,
            },
          }
          : p
      ))
      : restored.parts;
    return {
      ...restored,
      id: m.id || crypto.randomUUID(),
      role: m.role,
      crew: m.crew,
      streaming: false,
      thinking: (restored.thinking as string | undefined) || m.thinking,
      thinkingStartedAt: (restored.thinkingStartedAt as number | undefined) ?? m.thinkingStartedAt,
      thinkingDoneAt: (restored.thinkingDoneAt as number | undefined) ?? m.thinkingDoneAt,
      subAgents,
      parts,
      plan: typeof m.plan === 'string' ? JSON.parse(m.plan) : (m.plan || undefined),
    };
  }) as unknown as UIMessage[];
}

/** Build a streaming assistant bubble from mid-turn orphan parts + partial text. */
export function buildActiveTurnAssistantMessage(opts: {
  turnId?: string | null;
  partialContent?: string;
  activeParts?: Array<Record<string, unknown>>;
  backgroundTasks?: Array<{
    id?: string;
    status?: string;
    instruction?: string;
    childSessionId?: string;
  }>;
}): UIMessage {
  const toolCalls: NonNullable<UIMessage['toolCalls']> = [];
  const subAgents: NonNullable<UIMessage['subAgents']> = [];
  const parts: NonNullable<UIMessage['parts']> = [];
  let text = opts.partialContent ?? '';
  let thinking = '';

  const appendThinking = (delta: string) => {
    if (!delta) return;
    thinking = appendStreamText(thinking, delta);
    const last = parts[parts.length - 1];
    if (last?.type === 'thinking') {
      last.content = appendStreamText(last.content || '', delta);
    } else {
      parts.push({ type: 'thinking', id: crypto.randomUUID(), content: delta });
    }
  };

  for (const task of opts.backgroundTasks ?? []) {
    const id = String(task.childSessionId || task.id || '').trim();
    if (!id) continue;
    const status = String(task.status || 'running').toLowerCase();
    const mapped: 'running' | 'done' | 'error' =
      status === 'completed' || status === 'done' ? 'done'
        : status === 'failed' || status === 'error' ? 'error'
          : 'running';
    const agent = {
      id,
      name: 'Sub-Agent',
      task: String(task.instruction || '').slice(0, 200),
      status: mapped,
      kind: 'sub_agent' as const,
      sessionBound: true,
    };
    subAgents.push(agent);
    parts.push({ type: 'subagent', id, agent });
  }

  // Prefer assembling text from ordered deltas when partialContent is empty;
  // when both exist, trust partialContent and skip delta concat (avoids duplex).
  const deltaChunks: string[] = [];
  for (const raw of opts.activeParts ?? []) {
    const type = String(raw['type'] ?? '');
    if (type === 'reasoning-delta' || type === 'thinking-delta' || type === 'reasoning' || type === 'thinking') {
      appendThinking(String(raw['content'] ?? ''));
      continue;
    }
    if (type === 'subagent' || type === 'sub-agent') {
      const id = String(raw['toolCallId'] ?? raw['tool_call_id'] ?? raw['id'] ?? '').trim();
      if (!id || subAgents.some((a) => a.id === id)) continue;
      let args = raw['toolArgs'] ?? raw['tool_args'];
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      const argsObj = args && typeof args === 'object' ? args as Record<string, unknown> : {};
      const statusRaw = String(argsObj['status'] || 'running').toLowerCase();
      const agent = {
        id,
        name: String(argsObj['name'] || 'Sub-Agent'),
        task: String(raw['content'] || argsObj['task'] || ''),
        status: (statusRaw === 'error' || statusRaw === 'failed'
          ? 'error'
          : statusRaw === 'done' || statusRaw === 'completed'
            ? 'done'
            : 'running') as 'running' | 'done' | 'error',
        kind: 'sub_agent' as const,
        sessionBound: true,
      };
      subAgents.push(agent);
      parts.push({ type: 'subagent', id, agent });
      continue;
    }
    if (type === 'text-delta' || type === 'text') {
      const chunk = String(raw['content'] ?? '');
      if (chunk) deltaChunks.push(chunk);
      continue;
    }
    if (type === 'tool-call') {
      const id = String(raw['toolCallId'] ?? raw['tool_call_id'] ?? `tool-${toolCalls.length}`);
      const name = String(raw['toolName'] ?? raw['tool_name'] ?? 'tool');
      if (toolCalls.some((t) => t.id === id)) continue;
      let args: string | Record<string, unknown> = (raw['toolArgs'] ?? raw['tool_args'] ?? '') as string | Record<string, unknown>;
      if (typeof args === 'string' && args.trim().startsWith('{')) {
        try { args = JSON.parse(args) as Record<string, unknown>; } catch { /* keep string */ }
      }
      const tc = {
        id,
        name,
        args,
        status: 'running' as const,
      };
      toolCalls.push(tc);
      parts.push({ type: 'tool', id, tool: tc });
      continue;
    }
    if (type === 'tool-result') {
      const id = String(raw['toolCallId'] ?? raw['tool_call_id'] ?? '');
      const result = String(raw['toolResult'] ?? raw['tool_result'] ?? '');
      const successRaw = raw['toolSuccess'] ?? raw['tool_success'];
      const success = !(successRaw === false || successRaw === 0 || successRaw === '0');
      for (const t of toolCalls) {
        if (id && t.id !== id) continue;
        if (!id && t.status !== 'running') continue;
        t.status = success ? 'done' : 'error';
        t.result = result;
        if (id) break;
      }
      for (const p of parts) {
        if (p.type === 'tool' && p.tool && (!id || p.tool.id === id)) {
          if (!id && p.tool.status !== 'running') continue;
          p.tool = { ...p.tool, status: success ? 'done' : 'error', result };
          if (id) break;
        }
      }
    }
  }
  if (!text.trim() && deltaChunks.length) {
    text = deltaChunks.join('');
  }

  const cleanedThinking = thinking.trim() ? repairStreamTextGlitches(thinking.trim()) : undefined;
  if (cleanedThinking) {
    for (const p of parts) {
      if (p.type === 'thinking' && p.content) {
        p.content = repairStreamTextGlitches(p.content);
      }
    }
  }

  return {
    id: opts.turnId ? `assistant-turn-${opts.turnId}` : `assistant-live-${Date.now()}`,
    role: 'assistant',
    content: text,
    streaming: true,
    thinking: cleanedThinking,
    toolCalls,
    subAgents,
    parts,
  } as UIMessage;
}
