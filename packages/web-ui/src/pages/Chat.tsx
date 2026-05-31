import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiDelete, onWsEvent, sendWs } from '../api';
import ProviderModal from '../components/ProviderModal';
import { useToast } from '../components/ToastProvider';
import AgentTimeline from '../components/AgentTimeline';
import ChatEventCard from '../components/ChatEventCard';
import type { ToolCardData, ReasoningData, SubAgentData } from '../components/ChatEventCard';
import '../space-chat.css';

interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  done?: boolean;
  entered?: boolean;
}

interface PermissionRequest {
  tool: string;
  path: string;
  riskLevel: string;
}

interface SessionItem {
  id: string;
  title: string;
  model?: string;
  token_used?: number;
  updatedAt?: string;
  createdAt?: string;
}

interface ToolExecution {
  id: string;
  name: string;
  status: 'running' | 'complete' | 'error';
  startTime: number;
  elapsed?: number;
  output?: string;
  error?: string;
}

interface ClarificationRequest {
  question: string;
  options: string[];
  allowFreeform: boolean;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [timer, setTimer] = useState(0);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [tokens, setTokens] = useState<{ used: number; available: number } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [showSessions, setShowSessions] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeProvider, setActiveProvider] = useState('');
  const [activeModel, setActiveModel] = useState('');
  const [crews, setCrews] = useState<Array<{ id: string; name: string; isDefault?: boolean }>>([]);
  const [activeCrewId, setActiveCrewId] = useState('');

  // Provider modal
  const [showProviderModal, setShowProviderModal] = useState(false);
  const toast = useToast();
  const streamCounter = useRef(0);
  const [searchParams, setSearchParams] = useSearchParams();

  // File attachment
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Tool execution tracking (rich tool cards)
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const toolExecCounter = useRef(0);

  // Clarification modal
  const [clarification, setClarification] = useState<ClarificationRequest | null>(null);
  const [clarificationInput, setClarificationInput] = useState('');

  // Intent / RAG status
  const [agentStatus, setAgentStatus] = useState<{ intent?: string; ragCount?: number; ragElapsed?: number } | null>(null);

  // Agent timeline panel
  const [showTimeline, setShowTimeline] = useState(false);

  // Checkpoints
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Array<{ id: string; label: string; createdAt: string; messageCount: number }>>([]);
  const [restoringCheckpoint, setRestoringCheckpoint] = useState(false);

  // Sidebar stats
  const [todos, setTodos] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [totalCost, setTotalCost] = useState(0);

  // Reasoning content accumulator
  const [reasoningContent, setReasoningContent] = useState('');
  const [showReasoning, setShowReasoning] = useState(true);

  // Sub-agent event log
  const [subAgentEvents, setSubAgentEvents] = useState<SubAgentData[]>([]);

  // Restore session from URL query param on mount
  useEffect(() => {
    const urlSessionId = searchParams.get('session_id');
    if (urlSessionId) {
      restoreSession(urlSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadEverything();
    const unsub = onWsEvent((event) => {
      // Handle raw error messages from WS (fallback for ws.ts catch blocks)
      if (event.type === 'error') {
        setSending(false);
        setThinking(false);
        stopTimer();
        const msg = (event.message as string) || (event.data as Record<string, unknown>)?.message as string || 'Unknown error';
        setMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${msg}`, done: true }]);
        return;
      }

      if (event.type === 'engine_event') {
          const ev = event.event as string;
          const data = event.data as Record<string, unknown>;

          if (ev === 'stream_chunk') {
            setThinking(false);
            const content = data.content as string;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'assistant' && !last.done) {
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, text: last.text + content };
                return updated;
              }
              // create a stable temporary id for the streaming assistant message
              const id = `s-${Date.now()}-${streamCounter.current++}`;
              return [...prev, { id, role: 'assistant', text: content, done: false, entered: false }];
            });
          }

          if (ev === 'message_received') {
            // Attach final message content/id to the most recent incomplete assistant message.
            const msg = (data.message as any) || null;
            const finalText = msg?.content as string | undefined;
            const serverId = msg?.id as string | undefined;
            setMessages((prev) => {
              // If server provided an id that's already present in the list, update that message
              if (serverId) {
                const existingIndex = prev.findIndex((m) => m.id === serverId);
                if (existingIndex !== -1) {
                  const updated = [...prev];
                  updated[existingIndex] = {
                    ...updated[existingIndex],
                    text: (typeof finalText === 'string' && finalText.length > 0) ? finalText : updated[existingIndex].text,
                    done: true,
                  };

                  // Remove any other incomplete assistant placeholder that may be a duplicate
                  for (let j = updated.length - 1; j >= 0; j--) {
                    if (j !== existingIndex && updated[j].role === 'assistant' && !updated[j].done) {
                      updated.splice(j, 1);
                      break;
                    }
                  }

                  return updated;
                }
              }

              // Otherwise attach to the last incomplete assistant message if present
              for (let i = prev.length - 1; i >= 0; i--) {
                const m = prev[i];
                if (m.role === 'assistant' && !m.done) {
                  const updated = [...prev];
                  updated[i] = {
                    ...m,
                    id: serverId ?? m.id,
                    text: (typeof finalText === 'string' && finalText.length > 0) ? finalText : m.text,
                    done: true,
                  };
                  return updated;
                }
              }

              // No incomplete assistant message — append final message (avoid duplicates)
              return [...prev, { id: serverId, role: 'assistant', text: finalText || '', done: true }];
            });
            setSending(false);
            setThinking(false);
            stopTimer();
            setToolExecutions([]);
            setAgentStatus(null);
            setReasoningContent('');
            setSubAgentEvents([]);
            if (data.tokenUsed != null) {
              setTokens({ used: data.tokenUsed as number, available: data.tokenAvailable as number || 128000 });
            }
            // Do NOT reload sessions here — it causes the list to flicker/reorder on every message.
            // Sessions only need reloading on explicit actions: new, delete, restore.
          }

        if (ev === 'permission_required') {
          setPermission({ tool: data.tool as string, path: data.path as string, riskLevel: data.riskLevel as string });
        }

        if (ev === 'error') {
          setSending(false);
          setThinking(false);
          stopTimer();
          setMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${(data.message as string) || 'Unknown error'}`, done: true, entered: true }]);
        }

        if (ev === 'tool_executing') {
          const execId = `tool-${Date.now()}-${toolExecCounter.current++}`;
          setToolExecutions((prev) => [...prev, {
            id: execId,
            name: data.tool as string,
            status: 'running',
            startTime: Date.now(),
          }]);
        }

        if (ev === 'tool_complete') {
          const result = (data.result as { success?: boolean; output?: string; error?: string }) || {};
          const elapsed = (data.elapsed as number) || 0;
          setToolExecutions((prev) => {
            const last = [...prev];
            const idx = last.findIndex((t) => t.status === 'running');
            if (idx >= 0) {
              last[idx] = {
                ...last[idx],
                status: result.success ? 'complete' : 'error',
                elapsed,
                output: result.output,
                error: result.error,
              };
            }
            return last;
          });
        }

        if (ev === 'clarification_required') {
          setClarification({
            question: data.question as string,
            options: (data.options as string[]) || [],
            allowFreeform: data.allowFreeform as boolean,
          });
          setSending(false);
          setThinking(false);
          stopTimer();
        }

        if (ev === 'intent_detected') {
          setAgentStatus((prev) => ({ ...prev, intent: data.intent as string }));
        }

        if (ev === 'rag_queried') {
          setAgentStatus((prev) => ({
            ...prev,
            ragCount: data.resultCount as number,
            ragElapsed: data.elapsed as number,
          }));
        }

        // Reasoning accumulation
        if (ev === 'reasoning_start') {
          setReasoningContent('');
          setShowReasoning(true);
        }
        if (ev === 'reasoning_glimpse') {
          setReasoningContent((prev) => prev + ((data.text as string) || ''));
        }
        if (ev === 'reasoning_complete') {
          // reasoning finished, keep visible
        }

        // Sub-agent events
        if (ev === 'agent_spawned') {
          setSubAgentEvents((prev) => [...prev, {
            id: data.agentId as string,
            action: 'spawned',
            instruction: data.task as string,
          }]);
        }
        if (ev === 'agent_complete') {
          setSubAgentEvents((prev) => [...prev, {
            id: data.agentId as string,
            action: (data.summary as string)?.startsWith('Failed') ? 'failed' : 'complete',
            output: data.summary as string,
            elapsed: data.elapsed as number,
          }]);
        }
        if (ev === 'agent_progress') {
          setSubAgentEvents((prev) => {
            const last = prev.filter((s) => s.id === data.agentId);
            if (last.length > 0) return prev;
            return [...prev, {
              id: data.agentId as string,
              action: 'spawned',
              instruction: 'Running...',
            }];
          });
        }

        // Dispatch decomposition/subagent events for AgentTimeline
        if (['decomposition_start', 'decomposition_ready', 'decomposition_complete', 'decomposition_fallback', 'subagent_event'].includes(ev)) {
          window.dispatchEvent(new CustomEvent('agentx-timeline', { detail: { type: ev, ...data } }));
        }
      }
    });
    return unsub;
  }, []);

  // Restore session when URL session_id changes (browser navigation or deep link)
  // Clears active session when URL param is removed
  useEffect(() => {
    const urlSessionId = searchParams.get('session_id');
    if (urlSessionId && urlSessionId !== activeSessionId) {
      restoreSession(urlSessionId);
    } else if (!urlSessionId && activeSessionId) {
      setActiveSessionId(null);
      setMessages([]);
      setTokens(null);
    }
  }, [searchParams, activeSessionId]);

  // Smooth entry: mark newly-added messages as entered after a tick so CSS transitions apply
  useEffect(() => {
    if (messages.length === 0) return;
    const hasUnentered = messages.some((m) => !m.entered);
    if (!hasUnentered) return;
    const t = setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m.entered ? m : { ...m, entered: true })));
    }, 20);
    return () => clearTimeout(t);
  }, [messages.length]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    // Only scroll when the last message has been marked entered (animation complete)
    // or when thinking state changed (to ensure final scroll after completion)
    if (last.entered || !thinking) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, messages[messages.length - 1]?.entered, thinking]);

  async function loadEverything() {
    await Promise.all([loadConfig(), loadSessions()]);
  }

  async function loadConfig() {
    try {
      const [cfg, cr] = await Promise.all([
        apiGet<{ provider: { activeProvider: string; activeModel: string } }>('/api/config'),
        apiGet<{ crews: Array<{ id: string; name: string; isDefault?: boolean }>; activeId: string }>('/api/crews'),
      ]);
      setActiveProvider(cfg.provider.activeProvider);
      setActiveModel(cfg.provider.activeModel);
      setCrews(cr.crews);
      setActiveCrewId(cr.activeId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load configuration';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function loadSessions() {
    try {
      const list = await apiGet<SessionItem[]>('/api/sessions');
      // Deduplicate by session ID — backend may return duplicates during rapid reconnects
      const seen = new Set<string>();
      const deduped = list.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
      // Stable sort: newest first by createdAt, so the list never jumps around
      deduped.sort((a, b) => {
        const ta = a.createdAt || a.updatedAt || '';
        const tb = b.createdAt || b.updatedAt || '';
        return tb.localeCompare(ta);
      });
      setSessions(deduped);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load sessions';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function switchCrew(id: string) {
    try {
      await apiPost('/api/crew/switch', { id });
      setActiveCrewId(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to switch crew';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  function startTimer() {
    setTimer(0);
    timerRef.current = setInterval(() => setTimer((t) => t + 1), 100);
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function handleFileUpload(file: File) {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json() as { id: string; originalName: string };
      setAttachedFile({ id: data.id, name: data.originalName });
      toast.push(`Attached: ${data.originalName}`, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to upload file';
      toast.push(msg, 'error');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachment() {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function sendMessage() {
    if (!input.trim() || sending) return;
    if (!activeSessionId) {
      try { toast.push('No active session — create or restore a session first', 'error'); } catch { /* ignore */ }
      return;
    }
    let text = input.trim();
    // Append file reference if attached
    if (attachedFile) {
      text += `\n\n[Attached file: ${attachedFile.name}]`;
    }
    setInput('');
    setAttachedFile(null);
    setMessages((prev) => [...prev, { role: 'user', text, entered: true }]);
    setSending(true);
    setThinking(true);
    startTimer();
    try {
      // Send via WebSocket for real-time streaming (preferred)
      sendWs({ type: 'chat_message', text });
    } catch (e) {
      setSending(false); setThinking(false); stopTimer();
      const msg = e instanceof Error ? e.message : 'Failed to send message';
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Failed to send message.', done: true }]);
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  function formatTimer(ds: number) {
    const totalSec = Math.floor(ds / 10);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const d = ds % 10;
    return min > 0 ? `${min}m ${sec}s` : `${sec}.${d}s`;
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function respondToPermission(choice: 'allow_once' | 'allow_always' | 'deny') {
    sendWs({ type: 'permission_respond', choice });
    setPermission(null);
  }

  function respondToClarification(response: string) {
    sendWs({ type: 'clarification_response', response });
    setClarification(null);
    setClarificationInput('');
    setSending(true);
    setThinking(true);
    startTimer();
  }

  async function createCheckpoint() {
    if (!activeSessionId) return;
    try {
      const r = await apiPost<{ checkpointId: string; label: string }>(`/api/sessions/${activeSessionId}/checkpoint`, {});
      loadCheckpoints();
      try { toast.push(`Checkpoint created: ${r.label}`, 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Checkpoint failed';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function loadCheckpoints() {
    if (!activeSessionId) return;
    try {
      const r = await apiGet<{ checkpoints: typeof checkpoints }>(`/api/sessions/${activeSessionId}/checkpoints`);
      setCheckpoints(r.checkpoints);
    } catch { /* ignore */ }
  }

  async function restoreCheckpoint(checkpointId: string) {
    if (!activeSessionId || restoringCheckpoint) return;
    setRestoringCheckpoint(true);
    try {
      await apiPost(`/api/sessions/${activeSessionId}/checkpoint/${checkpointId}/restore`);
      setShowCheckpoints(false);
      // Reload the session to show restored messages
      await restoreSession(activeSessionId);
      try { toast.push('Session restored to checkpoint', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Restore failed';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setRestoringCheckpoint(false);
  }

  async function deleteCheckpoint(checkpointId: string) {
    if (!activeSessionId) return;
    try {
      await apiDelete(`/api/sessions/${activeSessionId}/checkpoint/${checkpointId}`);
      loadCheckpoints();
    } catch { /* ignore */ }
  }

  async function loadStats() {
    if (!activeSessionId) return;
    try {
      const r = await apiGet<{ todos: typeof todos }>(`/api/todos?sessionId=${activeSessionId}`);
      setTodos(r.todos || []);
    } catch { /* ignore */ }
    try {
      const s = await apiGet<{ sessions: Array<{ id: string; cost?: number }> }>('/api/sessions');
      const active = (s.sessions || []).find((x) => x.id === activeSessionId);
      setTotalCost(active?.cost || 0);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (activeSessionId) loadStats();
    const interval = setInterval(() => { if (activeSessionId) loadStats(); }, 5000);
    return () => clearInterval(interval);
  }, [activeSessionId]);

  function cancelMessage() {
    sendWs({ type: 'cancel' });
    setSending(false); setThinking(false); stopTimer();
  }

  async function restoreSession(sid: string) {
    setRestoring(true);
    try {
      const data = await apiPost<{ session: Record<string, unknown>; messages: Array<Record<string, unknown>> }>(`/api/sessions/${sid}/restore`);
      setActiveSessionId(sid);
      setSearchParams({ session_id: sid });
      if (data.messages?.length) {
        const seen = new Set<string>();
        const cleaned: Message[] = [];
        for (const m of data.messages as Array<Record<string, unknown>>) {
          const mid = (m.id as string) || undefined;
          if (mid && seen.has(mid)) continue;
          if (mid) seen.add(mid);
          cleaned.push({ id: mid, role: m.role as 'user' | 'assistant' | 'tool', text: (m.content as string) || (m.text as string) || '', done: true });
        }
        setMessages(cleaned);
      } else {
        setMessages([]);
      }
      if (data.session.token_used != null) {
        setTokens({ used: data.session.token_used as number, available: (data.session.token_available as number) || 128000 });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to restore session';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
      setSearchParams({}, { replace: true });
      setActiveSessionId(null);
      setMessages([]);
      setTokens(null);
    } finally {
      setRestoring(false);
    }
  }

  async function newSession() {
    if (creating) return;
    setCreating(true);
    try {
      try { toast.clear(); } catch { /* ignore */ }
      const data = await apiPost<{ sessionId: string }>('/api/sessions');
      setActiveSessionId(data.sessionId);
      setSearchParams({ session_id: data.sessionId });
      setMessages([]);
      setTokens(null);
      await loadSessions();
      try { toast.push('New session created', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to create session';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    } finally {
      setCreating(false);
    }
  }

  async function deleteSession(sid: string) {
    try {
      try { toast.clear(); } catch { /* ignore */ }
      await apiDelete(`/api/sessions/${sid}`);
      if (activeSessionId === sid) {
        setActiveSessionId(null);
        setSearchParams({}, { replace: true });
        setMessages([]);
        setTokens(null);
      }
      setDeleteConfirm(null);
      await loadSessions();
      try { toast.push('Session deleted', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to delete session';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
  }

  const pct = tokens ? Math.round((tokens.used / tokens.available) * 100) : 0;

  return (
    <>
      <div className="topbar">
        <div className="topbar-left" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="topbar-pill" onClick={() => setShowProviderModal(true)} title="Switch provider / model">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12, marginRight: 4, verticalAlign: 'middle' }}>
              <path d="M2 4.5L8 2l6 2.5v9L8 16l-6-2.5z"/><path d="M8 2v14"/><path d="M2 4.5l6 2.5M14 4.5l-6 2.5"/>
            </svg>
            {activeProvider} / {activeModel.split('/').pop() || '...'}
          </button>
          <select className="topbar-select" value={activeCrewId} onChange={(e) => switchCrew(e.target.value)}>
            {crews.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="topbar-right" style={{ gap: 12 }}>
          {sending && <span className="topbar-label">{formatTimer(timer)}</span>}
          <button className="topbar-pill" onClick={() => { setShowCheckpoints(true); loadCheckpoints(); }} title="Checkpoints / Branching">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12 }}>
              <path d="M3 3h4v4H3zM9 9h4v4H9z"/><path d="M5 7v2M7 5h2"/>
            </svg>
          </button>
          <button className="topbar-pill" onClick={() => setShowTimeline(!showTimeline)} title="Agent Timeline">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12 }}>
              <path d="M2 3h4v3H2zM10 3h4v3h-4zM2 10h4v3H2zM10 10h4v3h-4zM8 4.5v7"/>
            </svg>
          </button>
          <button className="topbar-pill" onClick={() => setShowSessions(!showSessions)} title="Toggle sessions">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12 }}>
              {showSessions ? <path d="M6 3v10M10 3v10"/> : <path d="M3 6h10M3 10h10"/>}
            </svg>
            {sessions.length}
          </button>
        </div>
      </div>

      {tokens && (
        <div style={{ height: 2, background: 'var(--space-bg)', position: 'relative' }}>
          <div className="token-bar-space" style={{ width: `${Math.min(pct, 100)}%`, height: '100%' }} />
        </div>
      )}

      {agentStatus && (
        <div className="agent-status-bar">
          {agentStatus.intent && (
            <span className="agent-status-chip">
              <span className="chip-dot" style={{ background: 'var(--space-accent)' }} /> INTENT
              <span className="agent-status-value">{agentStatus.intent}</span>
            </span>
          )}
          {agentStatus.ragCount !== undefined && agentStatus.ragCount > 0 && (
            <span className="agent-status-chip">
              <span className="chip-dot" style={{ background: 'var(--space-success)' }} /> RAG
              <span className="agent-status-value">{agentStatus.ragCount} docs ({agentStatus.ragElapsed}ms)</span>
            </span>
          )}
          {(reasoningContent || toolExecutions.length > 0) && (
            <span className="agent-status-chip" style={{ marginLeft: 'auto' }}>
              <span className="chip-dot" style={{ background: 'var(--space-warning)', animation: 'pulse 1.5s infinite' }} />
              <span className="agent-status-value">PROCESSING</span>
            </span>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!activeSessionId && !searchParams.get('session_id') ? (
          <div className="chat-empty-state">
            <div className="chat-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <h2 className="chat-empty-title">No Active Session</h2>
            <p className="chat-empty-desc">Launch a new session to start interacting with your agent crew.</p>
            <button className="chat-start-btn" onClick={newSession} disabled={creating}>
              <span>{creating ? 'CREATING...' : 'LAUNCH SESSION'}</span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><path d="M2 8h12M8 2l6 6-6 6"/></svg>
            </button>
          </div>
        ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="chat-area">
            {restoring && (
              <div style={{ textAlign: 'center', padding: 40, color: '#555', fontSize: '0.8rem' }}>
                <div style={{ marginBottom: 12 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" style={{ width: 24, height: 24, opacity: .4 }}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                </div>
                Restoring session...
              </div>
            )}
            {!restoring && messages.length === 0 && !thinking && (
              <div style={{ padding: '24px 24px 0' }}>
                <div style={{ textAlign: 'center', color: '#444', marginTop: 40 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ width: 32, height: 32, opacity: .3, marginBottom: 12 }}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <div style={{ fontSize: '0.85rem', color: '#555' }}>Type a message or restore a session</div>
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              // Skip tool messages — they're rendered as event cards below
              if (m.role === 'tool') return null;
              return (
                <div key={m.id ?? i} className={`chat-msg ${m.role === 'user' ? 'user' : 'agent'} ${m.entered ? 'entered' : ''}`}>
                  <div className={`chat-avatar ${m.role === 'user' ? 'user' : 'agent'}`}>
                    {m.role === 'user' ? (
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M11 12v-1a2.5 2.5 0 0 0-2.5-2.5h-3A2.5 2.5 0 0 0 3 11v1"/><circle cx="7" cy="4.5" r="2.5"/></svg>
                    ) : (
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5.5"/><path d="M7 2.5v9M9.5 4.5l-5 5"/></svg>
                    )}
                  </div>
                  <div className="chat-bubble">{m.text}{!m.done && m.role === 'assistant' && sending ? '▊' : ''}</div>
                </div>
              );
            })}

            {/* ─── EVENT CARDS ─── */}
            <div style={{ padding: '0 24px', maxWidth: 800, width: '100%', alignSelf: 'center' }}>
              {/* Reasoning panel */}
              {reasoningContent && (
                <ChatEventCard type="reasoning" data={{ content: reasoningContent }} index={0} />
              )}

              {/* Tool execution cards */}
              {toolExecutions.map((tool, i) => (
                <ChatEventCard key={tool.id} type="tool" data={tool} index={i + 1} />
              ))}

              {/* Sub-agent event cards */}
              {subAgentEvents.map((sub, i) => (
                <ChatEventCard key={sub.id + '-' + sub.action} type="subagent" data={sub} index={toolExecutions.length + i + 1} />
              ))}
            </div>

            {thinking && (
              <div className="chat-msg agent">
                <div className="chat-avatar agent">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5.5"/><path d="M7 2.5v9M9.5 4.5l-5 5"/></svg>
                </div>
                <div className="chat-bubble" style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '12px 18px' }}>
                  <span className="thinking-dot" style={{ animationDelay: '0s' }} />
                  <span className="thinking-dot" style={{ animationDelay: '0.2s' }} />
                  <span className="thinking-dot" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            )}

            {permission && (
              <div className="permission-banner" style={{ maxWidth: 600 }}>
                <div className="perm-tool">Tool: {permission.tool}</div>
                <div className="perm-path">Path: {permission.path}</div>
                <div className="perm-risk">Risk: {permission.riskLevel}</div>
                <div className="perm-actions">
                  <button className="btn btn-sm btn-secondary" onClick={() => respondToPermission('allow_once')}>Allow Once</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => respondToPermission('allow_always')}>Always Allow</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => respondToPermission('deny')}>Deny</button>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <div className="chat-input-area">
            {attachedFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', marginBottom: 8, background: '#0f0f0f', border: '1px solid #1a2a1a', borderRadius: 6, fontSize: '0.75rem', color: '#8c8' }}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 12, height: 12, flexShrink: 0 }}>
                  <path d="M8.5 2.5v8a2.5 2.5 0 1 1-5 0v-6a1.5 1.5 0 0 1 3 0v5"/>
                </svg>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachedFile.name}</span>
                <button className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: '0.7rem' }} onClick={removeAttachment}>
                  Remove
                </button>
              </div>
            )}
            <div className="chat-input-row">
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: '8px 10px' }}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending}
                title="Attach file"
              >
                {uploading ? (
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                ) : (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 14, height: 14 }}>
                    <path d="M8.5 2.5v8a2.5 2.5 0 1 1-5 0v-6a1.5 1.5 0 0 1 3 0v5"/>
                  </svg>
                )}
              </button>
              <input className="input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder={attachedFile ? 'Add a message (optional)...' : 'Ask your agent anything...'} disabled={sending} />
              {sending ? (
                <button className="btn btn-ghost" onClick={cancelMessage}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 14, height: 14 }}><rect x="3" y="3" width="10" height="10" rx="2"/></svg>
                </button>
              ) : (
                <button className="btn btn-primary" onClick={sendMessage} disabled={!input.trim() && !attachedFile}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><path d="M2 8h12M8 2l6 6-6 6"/></svg>
                </button>
              )}
            </div>
          </div>

          {/* Clarification modal */}
          {clarification && (
            <div className="overlay" onClick={() => setClarification(null)}>
              <div className="overlay-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
                <div className="overlay-title">Clarification Needed</div>
                <div className="overlay-desc" style={{ marginBottom: 16, color: '#aaa' }}>{clarification.question}</div>

                {clarification.options.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {clarification.options.map((opt) => (
                      <button key={opt} className="btn btn-sm btn-secondary" onClick={() => respondToClarification(opt)} style={{ textAlign: 'left' }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {clarification.allowFreeform && (
                  <div className="field">
                    <input className="input" value={clarificationInput} onChange={(e) => setClarificationInput(e.target.value)}
                      placeholder="Your response..." onKeyDown={(e) => { if (e.key === 'Enter') respondToClarification(clarificationInput); }} />
                  </div>
                )}

                <div className="overlay-actions" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setClarification(null)}>Cancel</button>
                  {clarification.allowFreeform && (
                    <button className="btn btn-sm btn-primary" onClick={() => respondToClarification(clarificationInput)} disabled={!clarificationInput.trim()}>
                      Respond
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Right sidebar: Sessions list (only when no active session) OR Stats panel */}
        {showSessions && (
          <div className="sessions-panel">
            <div className="sessions-panel-header">
              <span>{activeSessionId ? 'Stats' : 'Sessions'}</span>
              <button className="btn btn-sm btn-ghost" onClick={newSession} title="New session">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12 }}><path d="M8 3v10M3 8h10"/></svg>
              </button>
            </div>

            {!activeSessionId ? (
              /* Session list */
              <div className="sessions-panel-list">
                {sessions.length === 0 && (
                  <div style={{ padding: 16, textAlign: 'center', color: '#555', fontSize: '0.75rem' }}>No sessions yet</div>
                )}
                {sessions.map((s) => (
                  <div key={s.id} className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}>
                    <div className="session-item-row" onClick={() => { if (s.id !== activeSessionId) restoreSession(s.id); }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="session-item-title">{s.title}</div>
                        <div className="session-item-meta">{s.model?.split('/').pop() || ''}</div>
                      </div>
                    </div>
                    {deleteConfirm === s.id ? (
                      <div className="session-item-delete-confirm">
                        <span style={{ fontSize: '0.65rem', color: '#888' }}>Delete?</span>
                        <button className="btn btn-sm btn-ghost" style={{ color: '#c66', padding: '2px 6px', fontSize: '0.65rem' }} onClick={() => deleteSession(s.id)}>Yes</button>
                        <button className="btn btn-sm btn-ghost" style={{ padding: '2px 6px', fontSize: '0.65rem' }} onClick={() => setDeleteConfirm(null)}>No</button>
                      </div>
                    ) : (
                      <button className="session-item-delete" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(s.id); }} title="Delete session">
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 10, height: 10 }}><path d="M2 3.5h10M4.5 3.5V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M5.5 6v4M8.5 6v4M3 3.5l.7 8.4a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.4"/></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              /* Stats panel */
              <div style={{ padding: 12 }}>
                {/* Token progress */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: 4, fontFamily: 'monospace' }}>
                    Tokens {tokens ? `${tokens.used}/${tokens.available}` : '...'}
                  </div>
                  <div style={{ height: 4, background: 'var(--space-border)', borderRadius: 2 }}>
                    <div style={{
                      height: '100%',
                      width: `${tokens ? Math.min(tokens.used / tokens.available * 100, 100) : 0}%`,
                      background: tokens ? `linear-gradient(90deg, var(--space-success), ${tokens.used / tokens.available > 0.7 ? 'var(--space-warning)' : 'var(--space-success)'}, ${tokens.used / tokens.available > 0.9 ? 'var(--space-error)' : 'transparent'})` : 'transparent',
                      borderRadius: 2,
                      transition: 'width .5s ease',
                    }} />
                  </div>
                  {tokens && (
                    <div style={{ fontSize: '0.6rem', color: '#555', marginTop: 2, fontFamily: 'monospace', textAlign: 'right' }}>
                      {Math.round(tokens.used / tokens.available * 100)}%
                    </div>
                  )}
                </div>

                {/* Cost */}
                {totalCost > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: 2, fontFamily: 'monospace' }}>Cost</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--space-warning)', fontFamily: 'monospace' }}>
                      ${totalCost.toFixed(4)}
                    </div>
                  </div>
                )}

                {/* TODOs */}
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: 8, fontFamily: 'monospace' }}>
                    TODO ({todos.filter(t => t.status === 'completed').length}/{todos.length})
                  </div>
                  {todos.length === 0 ? (
                    <div style={{ color: '#555', fontSize: '0.65rem', fontFamily: 'monospace' }}>No tasks yet</div>
                  ) : (
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {todos.filter(t => t.status !== 'completed').map((t) => (
                        <div key={t.id} style={{
                          padding: '4px 0', borderBottom: '1px solid var(--space-border)',
                          fontSize: '0.65rem', fontFamily: 'monospace',
                          display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: t.status === 'in-progress' ? 'var(--space-warning)' : 'var(--space-text-muted)',
                            animation: t.status === 'in-progress' ? 'pulse 1.5s infinite' : undefined,
                          }} />
                          <span style={{ color: t.status === 'in-progress' ? '#ccc' : '#888' }}>
                            {t.title}
                          </span>
                        </div>
                      ))}
                      {todos.filter(t => t.status === 'completed').length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: '0.6rem', color: '#555', marginBottom: 4, fontFamily: 'monospace' }}>
                            Completed
                          </div>
                          {todos.filter(t => t.status === 'completed').slice(0, 5).map((t) => (
                            <div key={t.id} style={{
                              padding: '2px 0', fontSize: '0.6rem', color: '#555',
                              fontFamily: 'monospace', textDecoration: 'line-through',
                            }}>
                              {t.title}
                            </div>
                          ))}
                          {todos.filter(t => t.status === 'completed').length > 5 && (
                            <div style={{ fontSize: '0.6rem', color: '#555', fontFamily: 'monospace' }}>
                              +{todos.filter(t => t.status === 'completed').length - 5} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Provider modal */}
      {showProviderModal && (
        <ProviderModal onClose={() => setShowProviderModal(false)} onSwitch={() => loadEverything()} />
      )}

      {/* Agent Timeline panel */}
      <AgentTimeline visible={showTimeline} />

      {/* Checkpoints / Message Branching modal */}
      {showCheckpoints && (
        <div className="overlay" onClick={() => setShowCheckpoints(false)}>
          <div className="overlay-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <button className="overlay-close" onClick={() => setShowCheckpoints(false)}>✕</button>
            <div className="overlay-title">Message Branches</div>
            <div className="overlay-desc" style={{ marginBottom: 12 }}>Save and restore conversation checkpoints.</div>

            <button className="btn btn-sm btn-primary" onClick={createCheckpoint} style={{ marginBottom: 12, width: '100%' }}>
              + Create Checkpoint
            </button>

            {checkpoints.length === 0 ? (
              <div style={{ color: '#555', fontSize: '0.8rem', textAlign: 'center', padding: 16 }}>
                No checkpoints yet. Create one to save your current conversation state.
              </div>
            ) : (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {checkpoints.map((ckpt) => (
                  <div key={ckpt.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                    borderBottom: '1px solid #1a1a1a', fontSize: '0.8rem',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#ccc' }}>{ckpt.label}</div>
                      <div style={{ color: '#555', fontSize: '0.7rem' }}>
                        {ckpt.messageCount} messages · {new Date(ckpt.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <button className="btn btn-sm btn-ghost" onClick={() => restoreCheckpoint(ckpt.id)} disabled={restoringCheckpoint}>
                      {restoringCheckpoint ? '...' : 'Restore'}
                    </button>
                    <button className="btn btn-sm btn-ghost" style={{ color: '#c66' }} onClick={() => deleteCheckpoint(ckpt.id)}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 12, height: 12 }}><path d="M4 4h8M6 4V2h4v2M5 4v9h6V4"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
