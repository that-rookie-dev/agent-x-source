import React, { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';

import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import LinearProgress from '@mui/material/LinearProgress';
import Collapse from '@mui/material/Collapse';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChecklistIcon from '@mui/icons-material/Checklist';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import QueueIcon from '@mui/icons-material/PlaylistAdd';
import BoltIcon from '@mui/icons-material/Bolt';

import ReplayIcon from '@mui/icons-material/Replay';
import RouteIcon from '@mui/icons-material/Route';
import SearchIcon from '@mui/icons-material/Search';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import HistoryIcon from '@mui/icons-material/History';
import DownloadIcon from '@mui/icons-material/Download';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { chat, sessions, todos, tools, models, crews, providers, system, sessionSettings, connectSSE, type TelemetryEvent, type ChatMessage, type TodoItem, type SessionInfo, type Crew, type AgentMode, type ModelInfo, type ConnectionState } from '../api';
import { colors } from '../theme';
import {
  ConnectionHealthDot,
  ScrollToBottomPill,
  CommandPalette,
  SessionSearchModal,
  ReasoningBlock,
  CheckpointDrawer,
  StreamingCursor,
  CrewMentionMenu,
  type PaletteAction,
} from './ChatEnhancements';
import { MentionInput } from './MentionInput';
import { FolderPickerModal } from './FolderPickerModal';
import { ToolCallCard } from './visuals/ToolCallCard';

// ─── CSS Keyframes (injected once) ───
const styleId = 'agentx-chat-keyframes';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes agentx-pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }
    @keyframes agentx-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes agentx-fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  `;
  document.head.appendChild(style);
}

interface UIMessage extends ChatMessage {
  thinking?: string;
  thinkingStartedAt?: number;
  thinkingDoneAt?: number;
  toolCalls?: ToolCall[];
  subAgents?: SubAgent[];
  todos?: TodoItem[];
  streaming?: boolean;
  plan?: string[];
  attachments?: { name: string }[];
  turnTokens?: number;
  turnCostUsd?: number;

  crew?: { crewId: string; name: string; callsign: string };
  parts?: PartEntry[];
}

interface PartEntry {
  type: 'text' | 'tool' | 'subagent';
  id: string;
  content?: string;
  tool?: ToolCall;
  agent?: SubAgent;
}

interface ToolCall {
  id: string;
  name: string;
  args?: string | Record<string, unknown>;
  result?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: number;
}

interface SubAgent {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

interface FileAttachment {
  name: string;
  content: string;
}

type ChatView = 'sessions' | 'chat';

interface ChatPanelProps {
  sessionId?: string;
}

export function ChatPanel({ sessionId }: ChatPanelProps) {
  const navigate = useNavigate();
  const [view, setView] = useState<ChatView>(sessionId ? 'chat' : 'sessions');
  const [sessionList, setSessionList] = useState<SessionInfo[]>([]);
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [permissionPrompt, setPermissionPrompt] = useState<{ tool: string; path: string; riskLevel: string } | null>(null);
  const [toolEnablePrompt, setToolEnablePrompt] = useState<{ toolId: string; toolName: string } | null>(null);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const skipRestoreRef = useRef(false);

  // Loading step indicator state
  const [loadingSteps, setLoadingSteps] = useState<Array<{ id: string; label: string; status: string }> | null>(null);

  // Provider error band state — array of messages for unified warning band
  const [warnings, setWarnings] = useState<string[]>([]);

  // Clarification suggestions state
  const [clarification, setClarification] = useState<{ question: string; options: string[]; recommended?: string; allowChooseAll?: boolean } | null>(null);
  const [clarifySelectedIdx, setClarifySelectedIdx] = useState(0);
  const [clarifyCustomText, setClarifyCustomText] = useState('');
  const clarifyCustomRef = useRef<HTMLInputElement>(null);
  const providerErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract a clean, human-readable message from raw provider errors
  const extractProviderError = useCallback((raw: string): string => {
    // Try to extract the "message" field from JSON error responses
    const msgMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
    let msg = '';
    if (msgMatch?.[1]) {
      msg = msgMatch[1];
    } else {
      // Try pattern: "Provider API error (CODE): ..."
      const prefixMatch = raw.match(/^\w+\s+API\s+error\s*\(\d+\):\s*(.*)/is);
      msg = prefixMatch?.[1] ?? raw;
    }
    // Decode unicode escapes, escaped sequences, and strip non-readable chars
    try { msg = JSON.parse(`"${msg.replace(/"/g, '\\"')}"`); } catch { /* use as-is */ }
    msg = msg
      .replace(/\\n/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\r/g, '')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Strip variable retry time suffix so dedup works across retries
    msg = msg.replace(/\s*Please retry in [\d.]+s\.?\s*$/, '');
    return msg;
  }, []);

  // Replace a warning if one with the same tool name (doom loop) exists, else append
  const replaceWarning = useCallback((prev: string[], newMsg: string): string[] => {
    // Detect doom-loop style: "toolName called Nx consecutively" or "[DOOM LOOP DETECTED] toolName"
    const doomMatch = newMsg.match(/(\[DOOM LOOP DETECTED\])?\s*(\S+?)\s*(?:called|repeated)/i);
    if (doomMatch) {
      const toolName = doomMatch[2];
      const idx = prev.findIndex(w => w.includes(toolName) && /(called|repeated)\s+\d+\s*x?/i.test(w));
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = newMsg;
        return copy;
      }
    }
    return prev.includes(newMsg) ? prev : [...prev, newMsg];
  }, []);

  // Sync view with sessionId prop from URL — also restore session history on mount/refresh
  useEffect(() => {
    if (sessionId) {
      if (skipRestoreRef.current) {
        skipRestoreRef.current = false;
        setView('chat');
        return;
      }
      setView('chat');
      setCurrentSessionId(sessionId);
      setShowJumpPill(false);
      setUnreadCount(0);
      sessions.restore(sessionId).then(({ messages: historyMsgs, session }) => {
        const visible = historyMsgs.filter((m: any) => m.role !== 'part');
        setMessages(visible.map((m: any) => ({
          ...m,
          id: m.id || crypto.randomUUID(),
          streaming: false,
          toolCalls: m.toolCalls?.map((tc: any) => ({ ...tc, status: 'done' as const })),
          subAgents: m.subAgents?.map((sa: any) => ({ ...sa, status: 'done' as const })),
          plan: typeof m.plan === 'string' ? JSON.parse(m.plan) : (m.plan || undefined),
        })) as unknown as UIMessage[]);
        setCurrentSessionTitle(session.title ?? `Session ${sessionId.slice(0, 8)}`);
        const totalUsed = (session as any).tokenUsed ?? session.tokensUsed ?? 0;
        setTokenUsed(totalUsed);
        const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        setTokenInput(inputEst);
        setTokenOutput(outputEst);
        if (session.scopePath) setCwd(session.scopePath);
        loadTodos();
      }).catch((err) => {
        console.error('Failed to restore session on mount:', err);
      });
    } else {
      setView('sessions');
    }
  }, [sessionId]);

  // Right sidebar state
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [tokenUsed, setTokenUsed] = useState(0);
  const [tokenInput, setTokenInput] = useState(0);
  const [tokenOutput, setTokenOutput] = useState(0);
  const [tokenInputPrice, setTokenInputPrice] = useState(0);
  const [tokenOutputPrice, setTokenOutputPrice] = useState(0);
  const [tokenTotal, setTokenTotal] = useState(128000);
  const [compactionCount, setCompactionCount] = useState(0);
  

  // Model/Provider state
  const [currentModel, setCurrentModel] = useState('');
  const [currentProvider, setCurrentProvider] = useState('');
  const [providerList, setProviderList] = useState<Array<{ id: string; label: string; providerId: string }>>([]);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Crew state (fixed per session)
  const [crewList, setCrewList] = useState<Crew[]>([]);

  // Agent mode
  const [agentMode, setAgentMode] = useState<AgentMode>('agent');
  

  // CWD
  const [cwd, setCwd] = useState('');

  // Dropdown anchors
  const [modeMenuAnchor, setModeMenuAnchor] = useState<null | HTMLElement>(null);
  const [providerMenuAnchor, setProviderMenuAnchor] = useState<null | HTMLElement>(null);
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);

  // Send action menu (stop & send / queue / steer)
  const [sendMenuAnchor, setSendMenuAnchor] = useState<null | HTMLElement>(null);

  // New session dialog
  // ─── Enhancements: connection health, palette, slash, search, checkpoints ───
  const [connState, setConnState] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerCallback, setFolderPickerCallback] = useState<((path: string) => void) | null>(null);
  const [folderConsentOpen, setFolderConsentOpen] = useState(false);
  const [folderPickerLoading, setFolderPickerLoading] = useState(false);
  const pendingFolderActionRef = useRef<'newSession' | 'changeCwd' | null>(null);
  // @-mention detection
  const [showCrewMention, setShowCrewMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const insertMentionRef = useRef<((callsign: string) => void) | null>(null);
  const mentionActiveRef = useRef(false);
  useEffect(() => {
    const active = mentionQuery !== null;
    mentionActiveRef.current = active;
    setShowCrewMention(active);
  }, [mentionQuery]);

  const handleMentionSelect = useCallback((crew: Crew) => {
    mentionActiveRef.current = false;
    insertMentionRef.current?.(crew.callsign);
    setShowCrewMention(false);
    setMentionQuery(null);
  }, []);

  const handleMentionSelectAgent = useCallback(() => {
    mentionActiveRef.current = false;
    insertMentionRef.current?.('agentx');
    setShowCrewMention(false);
    setMentionQuery(null);
  }, []);

  // Smart auto-scroll state
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);
  const [showJumpPill, setShowJumpPill] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // ─── Smart auto-scroll: track user scroll position ───
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        setShowJumpPill(false);
        setUnreadCount(0);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [view]);

  // Auto-scroll only when user is at bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setShowJumpPill(true);
      setUnreadCount(c => c + 1);
    }
  }, [messages, streaming]);

  // Load sessions
  const loadSessions = useCallback(() => {
    sessions.list().then(setSessionList).catch(() => {});
  }, []);

  // Load sessions on mount and when view becomes 'sessions'
  useEffect(() => {
    if (view === 'sessions') loadSessions();
  }, [view, loadSessions]);

  // Load todos
  const loadTodos = useCallback(() => {
    todos.list().then(setTodoItems).catch(() => {});
  }, []);

  // Load model, provider, crew, cwd, session settings
  useEffect(() => {
    // Get current model/provider - fallback to providers endpoint if models fails
    models.current()
      .then((r) => { setCurrentModel(r.model || ''); setCurrentProvider(r.activeProfile || r.provider || ''); })
      .catch(() => {
        // Fallback: get active provider from /providers endpoint
        fetch('/api/providers', { credentials: 'include' })
          .then(r => r.json())
          .then((data: { active?: string }) => { if (data.active) setCurrentProvider(data.active); })
          .catch(() => {});
      })
      .finally(() => { setConfigLoaded(true); });
    crews.list().then((list) => { setCrewList(list); }).catch(() => {});
    system.cwd().then((r) => { setCwd(r.cwd || ''); }).catch(() => {});
    sessionSettings.get().then((s) => { if (s.mode === 'agent' || s.mode === 'plan') setAgentMode(s.mode); else setAgentMode('agent'); }).catch(() => {});
    // Load configured provider profiles
    fetch('/api/providers', { credentials: 'include' })
      .then(r => r.json())
      .then((data: { active?: string; providers?: Array<{ id: string; activeProfile?: string; profiles?: Array<{ id: string; label: string }> }> }) => {
        if (data.providers) {
          const allProfiles: Array<{ id: string; label: string; providerId: string }> = [];
          data.providers.forEach(p => {
            if (p.profiles && p.profiles.length > 0) {
              p.profiles.forEach(prof => allProfiles.push({ id: prof.id, label: prof.label, providerId: p.id }));
            } else {
              // Fallback: single default profile
              allProfiles.push({ id: p.id + '-default', label: p.id, providerId: p.id });
            }
          });
          setProviderList(allProfiles);
        }
      })
      .catch(() => {});
  }, []);

  // Load models when provider changes
  useEffect(() => {
    if (!currentProvider) { setModelList([]); return; }
    const profile = providerList.find(p => p.id === currentProvider);
    const providerId = profile?.providerId || currentProvider;
    setLoadingModels(true);
    providers.models(providerId).then((m) => { setModelList(m); }).catch(() => { setModelList([]); }).finally(() => setLoadingModels(false));
  }, [currentProvider, providerList]);

  useEffect(() => { loadTodos(); }, [loadTodos]);

  // Update tokenTotal when model's context window is known
  useEffect(() => {
    if (!currentModel || modelList.length === 0) return;
    const match = modelList.find(m => m.id === currentModel);
    if (match?.contextWindow) setTokenTotal(match.contextWindow);
  }, [currentModel, modelList]);

  // Helper to immutably update the last assistant message (avoids React mutation anti-pattern).
  // Defined at component level so other effects (streaming timeout, SSE handler) can share it.
  const updateLastMessage = (msgs: UIMessage[], updates: Partial<UIMessage>): UIMessage[] => {
    if (msgs.length === 0) return msgs;
    const last = msgs[msgs.length - 1];
    if (last?.role !== 'assistant') return msgs;
    return [...msgs.slice(0, -1), { ...last, ...updates }];
  };

  // Connect SSE for streaming events
  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleEvent = (ev: TelemetryEvent) => {
      // Reset activity timer on every event from the agent
      lastActivityRef.current = Date.now();
      setLastEventAt(Date.now());

      setMessages((prev) => {
        const last = prev[prev.length - 1];

        switch (ev.type) {
          case 'loading_start': {
            setLoadingSteps(null);
            // Only create a placeholder when a user message just arrived (new turn).
            // If the last message is a completed assistant (race with handleSend),
            // let stream_chunk or message_received handle the placeholder instead.
            if (last?.role === 'user') {
              setStreaming(true);
              return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
            }
            if (!last) {
              setStreaming(true);
              return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
            }
            setStreaming(true);
            return prev;
          }

          case 'loading_step_update':
            setLoadingSteps((prevSteps) => {
              if (!prevSteps) return prevSteps;
              return prevSteps.map((s) =>
                s.id === ev.stepId ? { ...s, status: ev.status as string } : s,
              );
            });
            return prev;

          case 'stream_chunk': {
            const delta = (ev.content as string) ?? '';
            const fullContent = (ev.fullContent as string) ?? '';
            if (last?.role === 'assistant' && last.streaming) {
              const parts = last.parts || [];
              const lastPart = parts[parts.length - 1];
              if (lastPart?.type === 'text') {
                // Append delta to existing text part
                const updatedParts = [...parts.slice(0, -1), { ...lastPart, content: (lastPart.content || '') + delta }];
                return updateLastMessage(prev, { content: fullContent, parts: updatedParts });
              } else {
                // Create new text part after tools
                const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: delta };
                return updateLastMessage(prev, { content: fullContent, parts: [...parts, textPart] });
              }
            }
            setStreaming(true);
            const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: delta };
            return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: delta, streaming: true, parts: [textPart] }];
          }

          case 'loading_end':
            setLoadingSteps(null);
            setStreaming(false);
            return prev;

          case 'message_received': {
            const msg = ev.message as { id?: string; content?: string; role?: string; parts?: PartEntry[]; toolCalls?: ToolCall[]; crew?: { crewId: string; name: string; callsign: string }; tokenCount?: number } | undefined;
            const crew = msg?.crew;
            setStreaming(false);
            if (!msg || msg.role === 'system') return prev;
            const text = msg.content ?? '';
            if (last?.role === 'assistant') {
              if (last.streaming) {
                if (last.content) {
                  // Streaming already showed content — just finalize with accumulated parts
                  return updateLastMessage(prev, { streaming: false, ...(crew ? { crew } : {}) });
                }
                return updateLastMessage(prev, { content: text || last.content, streaming: false, ...(crew ? { crew } : {}) });
              }
              return updateLastMessage(prev, { streaming: false, ...(crew ? { crew } : {}) });
            }
            if (msg.role === 'assistant' && text) {
              const parts = msg.parts || (last?.parts) || [{ type: 'text' as const, id: crypto.randomUUID(), content: text }];
              return [...prev, { id: msg.id || crypto.randomUUID(), role: 'assistant' as const, content: text, streaming: false, parts, ...(crew ? { crew } : {}) } as UIMessage];
            }
            return prev;
          }

          case 'tool_executing': {
            if (last?.role !== 'assistant') return prev;
            const toolName = (ev.tool as string) ?? 'unknown';
            const desc = (ev.description as string) ?? '';
            const eventArgs = (ev.args as Record<string, unknown> | string | undefined) ?? desc;
            const callId = (ev.callId as string) ?? crypto.randomUUID();

            if (toolName === 'delegate_to_subagent') {
              const sa: SubAgent = { id: callId, name: 'Sub-Agent', task: desc, status: 'running' };
              const saPart: PartEntry = { type: 'subagent', id: callId, agent: sa };
              return updateLastMessage(prev, {
                subAgents: [...(last.subAgents ?? []), sa],
                parts: [...(last.parts || []), saPart],
              });
            }

            const tc: ToolCall = { id: callId, name: toolName, args: eventArgs, status: 'running' };
            const toolPart: PartEntry = { type: 'tool', id: callId, tool: tc };
            const parts = [...(last.parts || []), toolPart];

            return updateLastMessage(prev, { toolCalls: [...(last.toolCalls ?? []), tc], parts });
          }

          case 'tool_complete': {
            if (last?.role !== 'assistant') return prev;
            const toolName = (ev.tool as string) ?? '';
            const elapsed = (ev.elapsed as number) ?? 0;
            const callId = (ev.callId as string) ?? '';
            const result = (ev as any).result ?? (ev as any).output as string ?? '';
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result ?? '');

            if (toolName === 'delegate_to_subagent' && last.subAgents) {
              const newSubAgents = last.subAgents.map((a: SubAgent) => {
                if (a.status !== 'running') return a;
                return { ...a, status: 'done' as const, result: resultStr };
              });
              // Update part too
              const newParts = (last.parts || []).map((p: PartEntry) =>
                p.type === 'subagent' && p.agent?.id === callId ? ({ ...p, agent: { ...p.agent!, status: 'done' as const, result: resultStr } }) : p
              );
              return updateLastMessage(prev, { subAgents: newSubAgents, parts: newParts });
            }

            // Update tool in both toolCalls array and parts array
            const newToolCalls = (last.toolCalls || []).map((t: ToolCall) => {
              if (callId && t.id !== callId) return t;
              if (!callId && (t.name !== toolName || t.status !== 'running')) return t;
              return { ...t, status: 'done' as const, result: resultStr, elapsed };
            });
            const newParts = (last.parts || []).map((p: PartEntry) => {
              if (p.type === 'tool' && p.tool) {
                if (callId && p.tool.id !== callId) return p;
                if (!callId && (p.tool.name !== toolName || p.tool.status !== 'running')) return p;
                return { ...p, tool: { ...p.tool, status: 'done' as const, result: resultStr, elapsed } };
              }
              return p;
            });
            let foundToolError = false;
            const resObj = typeof (ev as any).result === 'object' && (ev as any).result !== null ? (ev as any).result as Record<string, unknown> : null;
            if (resObj?.error === 'TOOL_NOT_FOUND' || resObj?.error === 'NO_HANDLER') foundToolError = true;
            if (foundToolError) setToolEnablePrompt({ toolId: toolName, toolName });
            return updateLastMessage(prev, { toolCalls: newToolCalls, parts: newParts });
          }

          case 'todo_update': {
            setTodoItems(ev.items as TodoItem[]);
            return last?.role === 'assistant' ? updateLastMessage(prev, { todos: ev.items as TodoItem[] }) : prev;
          }

          case 'plan_generated': {
            if (last?.role !== 'assistant') return prev;
            const plan = ev.plan as { steps?: { description: string }[] } | undefined;
            if (plan?.steps) {
              return updateLastMessage(prev, { plan: plan.steps.map((s) => s.description) });
            }
            return prev;
          }

          case 'token_usage': {
            const used = ev.totalTokens as number | undefined;
            if (used != null) setTokenUsed(prev => Math.max(prev, used));
            const cw = ev.contextWindow as number | undefined;
            if (cw != null && cw > 0) setTokenTotal(cw);
            const inp = ev.inputTokens as number | undefined;
            if (inp != null) setTokenInput(prev => Math.max(prev, inp));
            const out = ev.outputTokens as number | undefined;
            if (out != null) setTokenOutput(prev => Math.max(prev, out));
            const ip = ev.inputPrice as number | undefined;
            if (ip !== undefined) setTokenInputPrice(ip);
            const op = ev.outputPrice as number | undefined;
            if (op !== undefined) setTokenOutputPrice(op);
            if (last?.role !== 'assistant') return prev;
            const turn = ev.turnTokens as number | undefined;
            const cost = ev.costUsd as number | undefined;
            const updates: Partial<UIMessage> = {};
            if (turn != null) updates.turnTokens = turn;
            if (cost != null) updates.turnCostUsd = cost;
            return Object.keys(updates).length > 0 ? updateLastMessage(prev, updates) : prev;
          }

          case 'compaction_complete':
            setCompactionCount(c => c + 1);
            return prev;

          case 'reasoning_delta':
          case 'thinking_delta': {
            if (last?.role !== 'assistant') return prev;
            const delta = (ev.content as string) ?? (ev.text as string) ?? '';
            return updateLastMessage(prev, {
              thinking: (last.thinking ?? '') + delta,
              thinkingStartedAt: last.thinkingStartedAt ?? Date.now(),
            });
          }

          case 'reasoning_end':
          case 'thinking_end':
            return last?.role === 'assistant' && last.thinking ? updateLastMessage(prev, { thinkingDoneAt: Date.now() }) : prev;

          case 'decision_made': {
            // Show decision as thinking phase on the streaming assistant message
            if (last?.role !== 'assistant' || !last.streaming) return prev;
            const path = (ev.executionPath as string) ?? '';
            const cls = (ev.messageClass as string) ?? '';
            return updateLastMessage(prev, { thinking: `${cls} → ${path}` });
          }

          case 'permission_required':
            setPermissionPrompt({
              tool: (ev.tool as string) ?? 'unknown',
              path: (ev.path as string) ?? '',
              riskLevel: (ev.riskLevel as string) ?? 'medium',
            });
            return prev;

          case 'provider_error': {
            const providerMsg = (ev.message as string) ?? 'Provider error';
            const msg = extractProviderError(providerMsg);
            setWarnings(prev => replaceWarning(prev, msg));
            if (providerErrorTimerRef.current) clearTimeout(providerErrorTimerRef.current);
            setStreaming(false);
            if (last?.role === 'assistant' && last.streaming && !last.content && !last.toolCalls?.length) {
              return prev.slice(0, -1);
            }
            if (last?.role !== 'assistant') return prev;
            return updateLastMessage(prev, { streaming: false });
          }

          case 'clarification_required': {
            setClarification({
              question: (ev.question as string) ?? 'Could you clarify?',
              options: (ev.options as string[]) ?? [],
              recommended: (ev.recommended as string) ?? undefined,
              allowChooseAll: (ev.allowChooseAll as boolean) ?? false,
            });
            setClarifySelectedIdx(0);
            return prev;
          }

          case 'error': {
            const errorText = (ev.message as string) ?? (ev.error as string) ?? 'Unknown error';
            // Route to warning band — errors should not pollute the chat bubble
            setWarnings(prev => replaceWarning(prev, errorText));
            setStreaming(false);
            if (last?.role === 'assistant' && last.streaming && !last.content && !last.toolCalls?.length) {
              return prev.slice(0, -1);
            }
            if (last?.role !== 'assistant') return prev;
            return updateLastMessage(prev, { streaming: false });
          }

          default:
            return prev;
        }
      });
    };

    disconnectRef.current = connectSSE({
      onEvent: handleEvent,
      onState: (state) => {
        setConnState(state);
        if (state === 'open') {
          setLastEventAt(Date.now());
        } else if (state === 'reconnecting') {
          // Safety: if streaming and SSE drops, force-close after a grace period
          // so the UI doesn't stay stuck in loading state forever.
          // Cleared if the connection restores before the timeout.
          reconnectTimeout = setTimeout(() => {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.streaming) {
                return updateLastMessage(prev, { streaming: false });
              }
              return prev;
            });
            setStreaming(false);
          }, 30000);
        }
        // Separate check: clear reconnect timeout when SSE restores
        if (state === 'open' && reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
      },
    });
    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      disconnectRef.current?.();
    };
  }, []);

  // Load history on mount — only if no sessionId (session restore handles it instead)
  useEffect(() => {
    if (sessionId) return;
    chat.history().then((h) => {
      const visible = h.filter((m) => m.role !== 'system');
      setMessages(visible.map((m) => ({ ...m, streaming: false })));
      const totalTokens = h.reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      setTokenUsed(totalTokens);
      const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      setTokenInput(inputEst);
      setTokenOutput(outputEst);
    }).catch(() => {});
  }, [sessionId]);

  // Streaming timeout — if no content or events arrive, fail gracefully.
  // Uses a ref to reset the timer on each new event (activity-based timeout).
  // - If no content starts within 60s, time out with error.
  // - If content is flowing but stalls for 60s, force-close streaming.
  const lastActivityRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!streaming) return;
    lastActivityRef.current = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed > 120000) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return updateLastMessage(prev, { content: '⚠️ Request timed out. The agent took too long to respond. Please try again.', streaming: false });
          }
          return prev;
        });
        setStreaming(false);
      } else if (elapsed > 60000) {
        // Force-close streaming if stuck for over 60s with no activity
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return updateLastMessage(prev, { streaming: false });
          }
          return prev;
        });
        setStreaming(false);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [streaming]);

  // Compute whether send is blocked due to missing provider/model
  const sendBlocked = !currentProvider || !currentModel;
  const sendBlockedReason = !currentProvider ? 'Select a provider before sending' : !currentModel ? 'Select a model before sending' : '';

  // Keep a ref in sync so callbacks (handleSend, ensureSession) never
  // capture a stale currentSessionId from a useCallback closure.
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);

  // Lazy session creation: create session only when first message is sent
  const ensureSession = async (): Promise<string | null> => {
    if (currentSessionIdRef.current) return currentSessionIdRef.current;
    try {
      const result = await sessions.create();
      const newId = result?.sessionId;
      if (newId) {
        setCurrentSessionId(newId);
        skipRestoreRef.current = true;
        navigate(`/console/chat/${newId}`);
        return newId;
      }
    } catch { /* ignore */ }
    return null;
  };

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = typeof overrideText === 'string' ? overrideText.trim() : input.trim();
    if ((!text && attachments.length === 0) || streaming) return;
    if (!currentProvider || !currentModel) return;

    // Create session lazily on first message
    if (!(await ensureSession())) return;

    setInput('');
    setStreaming(true);

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      streaming: false,
      attachments: attachments.map((a) => ({ name: a.name })),
    };
    // Add user message — SSE (loading_start) will create the assistant placeholder
    setMessages((prev) => [...prev, userMsg]);

    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);

    try {
      const result = await chat.send(text, fileRefs);
      // Fallback: if SSE didn't deliver the response (e.g., first message before agent existed),
      // display the response from the API call directly.
      // The API only resolves after agent.sendMessage() completes, so SSE should have
      // already delivered the content. This fallback handles edge cases where SSE missed it.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming && !last.content) {
          // Replace the empty streaming placeholder with the API response
          const content = result?.message?.content || '';
          if (content) {
            return [...prev.slice(0, -1), { ...result.message, streaming: false }];
          }
          // Clarification response: remove the empty placeholder, chips already showing
          if ((result as Record<string, unknown>)?.clarification) {
            return prev.slice(0, -1);
          }
        }
        // If SSE already delivered content, just finalize the streaming state
        if (last?.role === 'assistant' && last.streaming) {
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev;
      });
      setStreaming(false);
    } catch (err) {
      // Show actual error in the placeholder message
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const displayError = errorMsg.length > 200 ? errorMsg.slice(0, 200) + '...' : errorMsg;
      // Show provider error band for quota/auth errors (not in chat)
      const isProviderErr = /429|quota|billing|suspended|rate.?limit|api.?key|unauthorized|forbidden|exceeded|invalid.*key|disabled|expired|insufficient|credits|balance|dunning|deny/i.test(errorMsg);
      if (isProviderErr) {
        const msg = extractProviderError(errorMsg);
        setWarnings(prev => replaceWarning(prev, msg));
        if (providerErrorTimerRef.current) clearTimeout(providerErrorTimerRef.current);
        // Clear server-side agent processing state so next message isn't blocked
        chat.cancel().catch(() => {});
      } else {
        // Non-provider errors (e.g., "Agent is busy") — also show in warning band
        setWarnings(prev => replaceWarning(prev, displayError));
        chat.cancel().catch(() => {});
      }
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          // Remove the empty streaming placeholder — errors go to warning band, not chat
          return prev.slice(0, -1);
        }
        return prev;
      });
      setStreaming(false);
    }
  }, [input, streaming, attachments, currentProvider, currentModel, agentMode]);

  // Retry last user message — re-sends without duplicating the user message,
  // replaces the existing assistant response on success.
  const handleResend = useCallback(async (text: string) => {
    if (!text || streaming || !currentProvider || !currentModel) return;
    if (!(await ensureSession())) return;

    setStreaming(true);

    // Remove the old assistant response — SSE (loading_start) will create the placeholder
    setMessages(prev => {
      const last = prev[prev.length - 1];
      return last?.role === 'assistant' ? prev.slice(0, -1) : prev;
    });

    try {
      const result = await chat.send(text, undefined, true);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          if (!last.content && result?.message?.content) {
            return [...prev.slice(0, -1), { ...result.message, streaming: false }];
          }
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev;
      });
      setStreaming(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const displayError = errorMsg.length > 200 ? errorMsg.slice(0, 200) + '...' : errorMsg;
      const isProviderErr = /429|quota|billing|suspended|rate.?limit|api.?key|unauthorized|forbidden|exceeded|invalid.*key|disabled|expired|insufficient|credits|balance|dunning|deny/i.test(errorMsg);
      if (isProviderErr) {
        const msg = extractProviderError(errorMsg);
        setWarnings(prev => replaceWarning(prev, msg));
        chat.cancel().catch(() => {});
      } else {
        setWarnings(prev => replaceWarning(prev, displayError));
        chat.cancel().catch(() => {});
      }
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          return prev.slice(0, -1);
        }
        return prev;
      });
      setStreaming(false);
    }
  }, [streaming, currentProvider, currentModel]);

  // --- Clarification keyboard navigation & submission ---
  const clearClarification = useCallback(() => {
    setClarification(null);
    setClarifySelectedIdx(0);
    setClarifyCustomText('');
  }, []);

  const clarifySelectCount = useMemo(() => {
    if (!clarification) return 0;
    let count = clarification.options.length;
    if (clarification.allowChooseAll) count += 1;  // "Choose all"
    count += 1; // "Skip"
    return count;
  }, [clarification]);

  const handleClarifySubmit = useCallback(async (overrideText?: string) => {
    if (!clarification) return;
    const text = overrideText?.trim();
    clearClarification();
    setInput('');
    if (text) {
      await handleSend(text);
    }
  }, [clarification, clearClarification, handleSend]);

  const handleClarifyKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!clarification) return;
    const maxIdx = clarifySelectCount - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setClarifySelectedIdx((prev) => Math.min(prev + 1, maxIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setClarifySelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const isChooseAll = clarification.allowChooseAll && clarifySelectedIdx === clarification.options.length;
      const isSkip = clarifySelectedIdx === maxIdx;
      if (isSkip) {
        clearClarification();
      } else if (isChooseAll) {
        handleClarifySubmit(`All: ${clarification.options.join(', ')}`);
      } else if (clarifySelectedIdx < clarification.options.length) {
        handleClarifySubmit(clarification.options[clarifySelectedIdx]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearClarification();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (clarifyCustomRef.current) {
        clarifyCustomRef.current.focus();
        clarifyCustomRef.current.select();
      }
    }
  }, [clarification, clarifySelectedIdx, clarifySelectCount, clearClarification, handleClarifySubmit]);

  const handleClarifyCustomKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (clarifyCustomText.trim()) {
        handleClarifySubmit(clarifyCustomText);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearClarification();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setClarifySelectedIdx(0);
      // Focus back to the list container
      (e.currentTarget.closest('[data-clarify-list]') as HTMLElement | null)?.focus();
    }
  }, [clarifyCustomText, handleClarifySubmit, clearClarification]);

  const handleCancel = async () => {
    try { await chat.cancel(); } catch { /* ignore */ }
    setStreaming(false);
  };

  // ─── Slash command handler ───
  // ─── Global keyboard shortcuts ───
  // Tab key cycles mode when not typing in input
  const handleToggleMode = useCallback(() => {
    setAgentMode(prev => {
      const next = prev === 'agent' ? 'plan' : 'agent';
      sessionSettings.setMode(next).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Tab') {
        e.preventDefault();
        handleToggleMode();
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleResend(messages.filter(m => m.role === 'user').pop()?.content ?? '');
      } else if (e.key === 'Escape' && streaming) {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentSessionId, streaming, messages, handleResend, view, handleToggleMode]);

  // ─── Command palette actions ───
  const paletteActions: PaletteAction[] = useMemo(() => [
    { id: 'new-session', label: 'New session', hint: 'N', icon: <AddIcon sx={{ fontSize: 14 }} />, run: () => handleNewSession() },
    { id: 'sessions', label: 'Show all sessions', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => handleShowSessions() },
    { id: 'search', label: 'Search sessions', hint: '⌘F', icon: <SearchIcon sx={{ fontSize: 14 }} />, run: () => setSearchOpen(true) },
    { id: 'checkpoints', label: 'Open checkpoints', icon: <HistoryIcon sx={{ fontSize: 14 }} />, run: () => setCheckpointsOpen(true) },
    { id: 'mode-agent', label: 'Switch mode → Agent', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => { setAgentMode('agent'); sessionSettings.setMode('agent').catch(() => {}); } },
    { id: 'mode-plan', label: 'Switch mode → Plan', icon: <RouteIcon sx={{ fontSize: 14 }} />, run: () => { setAgentMode('plan'); sessionSettings.setMode('plan').catch(() => {}); } },
  ], []);

  const handleStopAndSend = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (!(await ensureSession())) return;
    setInput('');
    setSendMenuAnchor(null);
    setStreaming(true);
    const userMsg: UIMessage = { id: crypto.randomUUID(), role: 'user', content: text, streaming: false, attachments: attachments.map((a) => ({ name: a.name })) };
    setMessages((prev) => [...prev, userMsg, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }]);
    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);
    try {
      const result = await chat.stopAndSend(text, fileRefs);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming && !last.content) {
          return [...prev.slice(0, -1), { ...result.message, streaming: false }];
        }
        return prev;
      });
    } catch { /* handled by SSE */ }
    setStreaming(false);
  };

  const handleAddToQueue = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    try { await chat.queue(text, fileRefs); } catch { /* ignore */ }
    setInput('');
    setAttachments([]);
    setSendMenuAnchor(null);
  };

  const handleSteer = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (!(await ensureSession())) return;
    setInput('');
    setSendMenuAnchor(null);
    const userMsg: UIMessage = { id: crypto.randomUUID(), role: 'user', content: `↑ ${text}`, streaming: false };
    setMessages((prev) => [...prev, userMsg, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }]);
    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);
    try {
      const result = await chat.steer(text, fileRefs);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming && !last.content) {
          return [...prev.slice(0, -1), { ...result.message, streaming: false }];
        }
        return prev;
      });
    } catch { /* handled by SSE */ }
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (mentionActiveRef.current) { e.preventDefault(); return; }
      e.preventDefault();
      handleSend();
    }
    // Shift+Enter → let the textarea insert the newline (don't prevent default)
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [...prev, { name: file.name, content: reader.result as string }]);
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  const handleRemoveAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleShowSessions = () => {
    setStreaming(false);
    loadSessions();
    navigate('/console/chat');
  };

  const handleSelectSession = async (s: SessionInfo) => {
    setWarnings([]);
    setStreaming(false);
    try {
      const { messages: historyMsgs, session } = await sessions.restore(s.id);
      const visible = historyMsgs.filter((m: any) => m.role !== 'part');
      setMessages(visible.map((m: any) => ({
        ...m, id: m.id || crypto.randomUUID(), streaming: false,
        toolCalls: m.toolCalls?.map((tc: any) => ({ ...tc, status: 'done' as const })),
        subAgents: m.subAgents?.map((sa: any) => ({ ...sa, status: 'done' as const })),
        plan: typeof m.plan === 'string' ? JSON.parse(m.plan) : (m.plan || undefined),
      })) as unknown as UIMessage[]);
      setCurrentSessionTitle(s.title ?? `Session ${s.id.slice(0, 8)}`);
      setCurrentSessionId(s.id);
      setShowJumpPill(false);
      setUnreadCount(0);
      setTokenUsed(s.tokensUsed ?? 0);
      const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      setTokenInput(inputEst);
      setTokenOutput(outputEst);
      if (session?.scopePath) setCwd(session.scopePath);
      navigate(`/console/chat/${s.id}`);
      loadTodos();
    } catch { /* ignore */ }
  };

  const handleNewSession = async () => {
    pendingFolderActionRef.current = 'newSession';
    setFolderConsentOpen(true);
  };

  const startNewSession = async (folder: string) => {
    setWarnings([]);
    setStreaming(false);
    setMessages([]);
    setCurrentSessionTitle(null);
    setCurrentSessionId(null);
    setTokenUsed(0);
    setTokenInput(0);
    setTokenOutput(0);
    setCompactionCount(0);
    setTodoItems([]);
    setShowJumpPill(false);
    setUnreadCount(0);
    setCwd(folder);
    try { await system.setCwd(folder); } catch { /* ignore */ }
    setView('chat');
    if (location.pathname === '/console/chat') {
      navigate('/console/chat', { replace: true });
    } else {
      navigate('/console/chat');
    }
  };

  const handleDeleteSession = async (id: string) => {
    try { await sessions.delete(id); loadSessions(); } catch { /* ignore */ }
  };

  const handleFolderConsentConfirm = async () => {
    const action = pendingFolderActionRef.current;
    pendingFolderActionRef.current = null;
    setFolderConsentOpen(false);
    if (!action) return;

    setFolderPickerLoading(true);
    await new Promise(r => setTimeout(r, 400));
    setFolderPickerLoading(false);

    if (action === 'newSession') {
      setFolderPickerCallback(() => (path: string) => startNewSession(path));
    } else {
      setFolderPickerCallback(() => (path: string) => {
        system.setCwd(path).then(r => setCwd(r.cwd)).catch(() => {});
      });
    }
    setFolderPickerOpen(true);
  };

  // Token percentage
  const tokenPercent = tokenTotal > 0 ? Math.min((tokenUsed / tokenTotal) * 100, 100) : 0;

  // ─── Chat view ───
  const visibleMessages = messages.filter((m) => m.role !== 'system');

  return (
    <Box sx={{ height: '100%', display: 'flex' }}>
      {view === 'sessions' ? (
        <Box sx={{ height: '100%', flex: 1, display: 'flex', flexDirection: 'column', bgcolor: colors.bg.primary, position: 'relative', overflow: 'hidden' }}>
          {/* Subtle background grid effect */}
          <Box sx={{
            position: 'absolute', inset: 0, opacity: 0.03, pointerEvents: 'none',
            backgroundImage: `linear-gradient(${colors.border.subtle} 1px, transparent 1px), linear-gradient(90deg, ${colors.border.subtle} 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }} />

          {/* Header — HUD style */}
          <Box sx={{
            px: 3, py: 2, borderBottom: `1px solid ${colors.accent.blue}20`,
            display: 'flex', alignItems: 'center', gap: 1.5, position: 'relative', zIndex: 1,
            background: `linear-gradient(180deg, ${colors.accent.blue}05 0%, transparent 100%)`,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors.accent.green, boxShadow: `0 0 8px ${colors.accent.green}80` }} />
              <Typography sx={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', fontWeight: 700,
                color: colors.accent.green, letterSpacing: '3px',
              }}>
                SESSIONS
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: colors.text.dim }}>
              {sessionList.length} SESSION{sessionList.length !== 1 ? 'S' : ''}
            </Typography>
            <Button
              size="small"
              startIcon={<AddIcon sx={{ fontSize: 12 }} />}
              onClick={() => handleNewSession()}
              sx={{
                color: colors.accent.blue, fontSize: '0.6rem', textTransform: 'none', fontFamily: "'JetBrains Mono', monospace",
                border: `1px solid ${colors.accent.blue}30`, px: 1.5, py: 0.4, borderRadius: '4px',
                '&:hover': { bgcolor: colors.accent.blue + '15', borderColor: colors.accent.blue + '60' },
              }}
            >
              NEW SESSION
            </Button>
          </Box>

          {/* Session list */}
          <Box sx={{ flex: 1, overflow: 'auto', p: 2, position: 'relative', zIndex: 1 }}>
            {sessionList.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
                <Box sx={{
                  width: 64, height: 64, borderRadius: '50%',
                  border: `1px solid ${colors.border.strong}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: colors.bg.tertiary,
                }}>
                  <SmartToyIcon sx={{ fontSize: 28, color: colors.text.dim, opacity: 0.5 }} />
                </Box>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', color: colors.text.dim, letterSpacing: '2px', mb: 0.5 }}>
                    NO SESSIONS
                  </Typography>
                  <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, opacity: 0.6 }}>
                    Send a message to start your first session
                  </Typography>
                </Box>
                <Button
                  size="small"
                  onClick={() => handleNewSession()}
                  sx={{
                    mt: 1, color: colors.accent.blue, textTransform: 'none', fontSize: '0.65rem',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  NEW SESSION
                </Button>
              </Box>
            ) : (
              <List disablePadding>
                {sessionList.map((s) => {
                  const date = new Date(s.createdAt);
                  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                  const dateStr = date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
                  return (
                    <ListItemButton
                      key={s.id}
                      onClick={() => handleSelectSession(s)}
                      sx={{
                        borderRadius: '6px', mb: 1,
                        border: `1px solid ${colors.border.subtle}`,
                        borderLeft: `3px solid ${colors.accent.blue}40`,
                        px: 2, py: 1.5,
                        bgcolor: colors.bg.secondary,
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          bgcolor: colors.bg.tertiary,
                          borderLeftColor: colors.accent.blue,
                          transform: 'translateX(2px)',
                          boxShadow: `0 2px 12px ${colors.accent.blue}10`,
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        <SmartToyIcon sx={{ fontSize: 16, color: s.status === 'active' ? colors.accent.green : colors.text.dim }} />
                      </ListItemIcon>
                      <ListItemText
                        primary={s.title}
                        secondary={<span style={{ fontSize: '0.6rem', color: colors.text.dim }}>{dateStr} {timeStr}</span>}
                        primaryTypographyProps={{ sx: { fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
                        secondaryTypographyProps={{ sx: { fontSize: '0.6rem', mt: 0.25 } }}
                      />
                      {s.status === 'active' && (
                        <Box sx={{
                          ml: 1, px: 0.6, py: 0.15, borderRadius: '4px', fontSize: '0.45rem',
                          fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
                          bgcolor: colors.accent.green + '15', color: colors.accent.green,
                          border: `1px solid ${colors.accent.green}30`,
                        }}>
                          ACTIVE
                        </Box>
                      )}
                      <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                        sx={{ ml: 0.5, color: colors.text.dim, opacity: 0.4, '&:hover': { color: colors.accent.red, opacity: 1 } }}
                      >
                        <DeleteIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </Box>
        </Box>
      ) : (<>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <Box sx={{ px: 1.5, py: 0.5, borderBottom: `1px solid ${colors.border.default}`, display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 36 }}>
          <IconButton size="small" onClick={handleShowSessions} sx={{ color: colors.text.dim, p: 0.5 }}>
            <ArrowBackIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentSessionTitle ?? 'New Session'}
          </Typography>
          <ConnectionHealthDot state={connState} lastEventAt={lastEventAt} />
          <Tooltip title="Search all sessions (⌘F)" arrow>
            <IconButton size="small" onClick={() => setSearchOpen(true)} sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.blue } }}>
              <SearchIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Checkpoints (rollback)" arrow>
            <IconButton size="small" onClick={() => setCheckpointsOpen(true)} sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.blue } }}>
              <HistoryIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Export trajectory (JSON)" arrow>
            <IconButton
              size="small"
              onClick={() => { if (currentSessionId) sessions.exportTrajectory(currentSessionId); }}
              disabled={!currentSessionId}
              sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.green } }}
            >
              <DownloadIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Command palette (⌘K)" arrow>
            <IconButton size="small" onClick={() => setPaletteOpen(true)} sx={{ color: colors.text.dim, p: 0.5, '&:hover': { color: colors.accent.purple } }}>
              <BoltIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Button size="small" startIcon={<AddIcon sx={{ fontSize: 12 }} />} onClick={() => handleNewSession()}
            sx={{ color: colors.accent.green, fontSize: '0.55rem', textTransform: 'none', minWidth: 'auto' }}>
            New
          </Button>
        </Box>

        {/* Messages */}
        <Box ref={messagesContainerRef} sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5, position: 'relative' }}>
          {visibleMessages.length === 0 && !streaming && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Box sx={{ textAlign: 'center', maxWidth: 300 }}>
                <SmartToyIcon sx={{ fontSize: 36, color: colors.border.strong, mb: 1 }} />
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 500, color: colors.text.secondary, mb: 0.5 }}>How can I help?</Typography>
                <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, lineHeight: 1.5 }}>
                  Send a message, attach files, or ask me to execute tasks.
                </Typography>
              </Box>
            </Box>
          )}

          {visibleMessages.map((msg, idx) => {
            const isLastUser = msg.role === 'user' && visibleMessages.slice(idx + 1).every(m => m.role !== 'user');
             return (
               <Box key={msg.id}>
                  <MessageBubble
                    message={msg}
                    loadingSteps={idx === visibleMessages.length - 1 && msg.streaming && !msg.content ? loadingSteps : null}
                  />
                  {isLastUser && msg.content && (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', width: '100%', mt: -1, mb: 0.5, mr: 5 }}>
                     <IconButton size="small" onClick={() => handleResend(msg.content)}
                       sx={{ p: 0.3, opacity: 0.4, '&:hover': { opacity: 1, bgcolor: 'transparent' } }}>
                       <ReplayIcon sx={{ fontSize: 13 }} />
                     </IconButton>
                   </Box>
                 )}
               </Box>
            );
          })}
           {streaming && (visibleMessages.length === 0 || (visibleMessages[visibleMessages.length - 1]?.role !== 'assistant')) && (
            <ThinkingIndicator label={loadingSteps?.[0]?.label} />
          )}

           {toolEnablePrompt && (
            <ToolEnableBanner toolId={toolEnablePrompt.toolId} toolName={toolEnablePrompt.toolName} onRespond={() => setToolEnablePrompt(null)} />
          )}

          <div ref={bottomRef} />
          <ScrollToBottomPill
            visible={showJumpPill}
            unread={unreadCount}
            onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowJumpPill(false); setUnreadCount(0); }}
          />
        </Box>

        {/* ─── Unified Input Module ─── */}
        <Box sx={{ px: 2, pb: 1.5, pt: 1, position: 'relative' }}>
          {/* Unified warning band — combines provider errors and send-blocked notifications */}
          {(() => {
            const allWarnings: string[] = [...warnings];
            if (sendBlocked && configLoaded && sendBlockedReason) {
              allWarnings.unshift(sendBlockedReason);
            }
            const hasWarnings = allWarnings.length > 0;

            return (
          <Box sx={{
            position: 'relative',
            zIndex: 0,
            overflow: 'hidden',
            maxHeight: hasWarnings ? 260 : 0,
            opacity: hasWarnings ? 1 : 0,
            transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
            mb: hasWarnings ? '-20px' : 0,
          }}>
    <Box sx={{
      bgcolor: colors.accent.orange + '18',
      border: `1px solid ${colors.accent.orange}30`,
      borderBottom: 'none',
      borderRadius: '14px 14px 0 0',
      px: 1.5, pt: 1, pb: 1.5,
      display: 'flex', alignItems: 'flex-start', gap: 0.75,
      maxHeight: 250,
    }}>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.3, overflowY: 'auto', maxHeight: 240, pb: 1 }}>
                {allWarnings.map((msg, i) => (
                  <Typography key={i} sx={{
                    fontSize: '0.58rem',
                    color: colors.accent.orange,
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 500,
                    letterSpacing: '0.2px',
                    lineHeight: 1.5,
                    flexShrink: 0,
                  }}>
                    ⚠ {msg}
                  </Typography>
                ))}
              </Box>
              <IconButton
                size="small"
                onClick={() => setWarnings([])}
                sx={{ color: colors.accent.orange + 'cc', p: 0, minWidth: 0, '&:hover': { bgcolor: colors.accent.orange + '20' } }}
              >
                <CloseIcon sx={{ fontSize: 11 }} />
              </IconButton>
            </Box>
          </Box>
            );
          })()}

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.75 }}>
              {attachments.map((a, i) => (
                <Chip
                  key={i}
                  size="small"
                  icon={<InsertDriveFileIcon sx={{ fontSize: '13px !important' }} />}
                  label={a.name}
                  onDelete={() => handleRemoveAttachment(i)}
                  deleteIcon={<CloseIcon sx={{ fontSize: '13px !important' }} />}
                  sx={{ fontSize: '0.6rem', height: 22, bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.default}` }}
                />
              ))}
            </Box>
          )}

          {/* Single unified box: input + toolbar — border tinted by agent mode */}
          <Box sx={{
            position: 'relative',
            zIndex: 1,
            border: `1px solid ${agentMode === 'agent' ? colors.accent.orange + '60' : colors.border.default}`,
            borderRadius: '14px',
            bgcolor: colors.bg.tertiary,
            backgroundImage: agentMode === 'agent' ? `linear-gradient(${colors.accent.orange}08, ${colors.accent.orange}08)` : 'none',
            transition: 'border-color 0.2s, background-color 0.2s',
            '&:focus-within': { borderColor: agentMode === 'agent' ? colors.accent.orange + '90' : colors.border.strong },
          }}>
            {/* @-mention crew autocomplete */}
            {showCrewMention && (
              <CrewMentionMenu
                query={mentionQuery ?? ''}
                crewList={crewList}
                onSelect={(crew: Crew) => handleMentionSelect(crew)}
                onClose={() => setShowCrewMention(false)}
                onSelectAgent={handleMentionSelectAgent}
              />
            )}
            {/* No provider/model warning — merged into unified warning band below */}
            {/* Clarification panel: vertical list with keyboard navigation */}
            {clarification && (
              <Box
                data-clarify-list
                tabIndex={0}
                onKeyDown={handleClarifyKeyDown}
                sx={{
                  mx: 1.25, my: 0.5, py: 1, px: 1.5,
                  border: `1px solid ${colors.border.default}`,
                  borderRadius: 2,
                  bgcolor: colors.bg.secondary,
                  outline: 'none',
                  cursor: 'default',
                }}
              >
                {/* Question */}
                <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim, mb: 1 }}>
                  {clarification.question}
                </Typography>

                {/* Option items */}
                {clarification.options.map((opt, idx) => {
                  const isSelected = clarifySelectedIdx === idx;
                  const isRecommended = clarification.recommended === opt;
                  return (
                    <Box
                      key={idx}
                      onClick={() => { setClarifySelectedIdx(idx); handleClarifySubmit(opt); }}
                      onMouseEnter={() => setClarifySelectedIdx(idx)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1,
                        py: 0.75, px: 1, borderRadius: 1.5,
                        bgcolor: isSelected ? colors.bg.hover : 'transparent',
                        border: isSelected ? `1px solid ${colors.accent.blue}` : '1px solid transparent',
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                        mb: 0.25,
                      }}
                    >
                      <Box sx={{
                        width: 18, height: 18, borderRadius: '50%',
                        border: `2px solid ${isSelected ? colors.accent.blue : colors.border.default}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        {isSelected && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors.accent.blue }} />}
                      </Box>
                      <Typography sx={{
                        fontSize: '0.725rem',
                        color: isSelected ? colors.text.primary : colors.text.dim,
                        fontWeight: isSelected ? 600 : 400,
                        flex: 1,
                      }}>
                        {opt}
                      </Typography>
                      {isRecommended && (
                        <Typography sx={{
                          fontSize: '0.55rem',
                          color: colors.accent.blue,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          bgcolor: '#58a6ff18',
                          px: 0.75, py: 0.15,
                          borderRadius: 0.75,
                          flexShrink: 0,
                        }}>
                          Recommended
                        </Typography>
                      )}
                    </Box>
                  );
                })}

                {/* Choose All (if allowed) */}
                {clarification.allowChooseAll && (
                  <Box
                    onClick={() => {
                      handleClarifySubmit(`All: ${clarification.options.join(', ')}`);
                    }}
                    onMouseEnter={() => setClarifySelectedIdx(clarification.options.length)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1,
                      py: 0.75, px: 1, borderRadius: 1.5,
                      bgcolor: clarifySelectedIdx === clarification.options.length ? colors.bg.hover : 'transparent',
                      border: clarifySelectedIdx === clarification.options.length ? `1px solid ${colors.accent.blue}` : '1px solid transparent',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                      mb: 0.25, mt: 0.25,
                      borderTop: `1px solid ${colors.border.default}`,
                    }}
                  >
                    <Typography sx={{
                      fontSize: '0.725rem',
                      color: clarifySelectedIdx === clarification.options.length ? colors.text.primary : colors.text.dim,
                      fontWeight: clarifySelectedIdx === clarification.options.length ? 600 : 400,
                    }}>
                      Choose all
                    </Typography>
                  </Box>
                )}

                {/* Custom answer input */}
                <Box sx={{
                  display: 'flex', gap: 1, mt: 0.5, mb: 0.5,
                  borderTop: `1px solid ${colors.border.default}`,
                  pt: 0.75,
                }}>
                  <input
                    ref={clarifyCustomRef}
                    type="text"
                    value={clarifyCustomText}
                    onChange={(e) => setClarifyCustomText(e.target.value)}
                    onKeyDown={handleClarifyCustomKeyDown}
                    placeholder="Type a custom answer..."
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: `1px solid ${colors.border.default}`,
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: '0.7rem',
                      color: colors.text.primary,
                      outline: 'none',
                    }}
                  />
                  <Button
                    size="small"
                    disabled={!clarifyCustomText.trim()}
                    onClick={() => handleClarifySubmit(clarifyCustomText)}
                    sx={{
                      minWidth: 0, px: 1.5,
                      fontSize: '0.6rem', textTransform: 'none',
                      bgcolor: clarifyCustomText.trim() ? colors.accent.blue : colors.bg.tertiary,
                      color: clarifyCustomText.trim() ? colors.bg.primary : colors.text.dim,
                      '&:hover': { bgcolor: clarifyCustomText.trim() ? '#58a6ffcc' : colors.bg.hover },
                    }}
                  >
                    Send
                  </Button>
                </Box>

                {/* Skip / footer */}
                <Box sx={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderTop: `1px solid ${colors.border.default}`,
                  pt: 0.5, mt: 0.25,
                }}>
                  <Button
                    size="small"
                    onClick={clearClarification}
                    onMouseEnter={() => setClarifySelectedIdx(clarifySelectCount - 1)}
                    sx={{
                      fontSize: '0.6rem', textTransform: 'none',
                      color: colors.text.dim, minWidth: 0, px: 1,
                      '&:hover': { color: colors.text.primary, bgcolor: 'transparent' },
                    }}
                  >
                    Skip / Cancel
                  </Button>
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>
                    ↑↓ Navigate · Enter to select · Esc to cancel
                  </Typography>
                </Box>
              </Box>
            )}
            {/* Permission banner above input */}
            {permissionPrompt && (
              <Box sx={{ px: 1.25, pt: 1.25, pb: 0.5 }}>
                <PermissionBanner prompt={permissionPrompt} onRespond={() => setPermissionPrompt(null)} />
              </Box>
            )}
            {/* Input row */}
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, px: 1.25, py: 0.5 }}>
              <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelect} accept=".txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.yaml,.yml,.toml,.csv,.xml,.html,.css,.sh,.sql,.log,.env,.cfg,.ini,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt" />

              <MentionInput
                value={input}
                onChange={setInput}
                onKeyDown={handleKeyDown}
                onMentionQuery={(q: string | null) => setMentionQuery(q)}
                onInsertReady={(fn) => { insertMentionRef.current = fn; }}
                placeholder="@agentx — message your AI wingman..."
                crewList={crewList}
                disabled={streaming}
              />

              {streaming ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  <IconButton size="small" onClick={handleCancel} sx={{ color: colors.accent.red, p: 0.5 }}>
                    <StopIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                  {input.trim() && (
                    <IconButton size="small" onClick={(e) => setSendMenuAnchor(e.currentTarget)} sx={{ color: colors.text.dim, p: 0.25 }}>
                      <ExpandMoreIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  )}
                </Box>
              ) : (
                <Tooltip title={sendBlocked ? sendBlockedReason : ''} arrow disableHoverListener={!sendBlocked}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => handleSend()}
                      disabled={sendBlocked || (!input.trim() && attachments.length === 0)}
                      sx={{ color: sendBlocked ? colors.accent.red : colors.accent.blue, p: 0.5, '&.Mui-disabled': { color: sendBlocked ? colors.accent.red + '80' : colors.text.dim } }}
                    >
                      <SendIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}

              {/* Send action menu (shown during streaming when user types) */}
              <Menu anchorEl={sendMenuAnchor} open={Boolean(sendMenuAnchor)} onClose={() => setSendMenuAnchor(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200 } }}>
                <MenuItem onClick={handleStopAndSend} sx={{ fontSize: '0.7rem', py: 0.75 }}>
                  <StopIcon sx={{ fontSize: 14, mr: 1, color: colors.accent.red }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 500 }}>Stop and Send</Typography>
                    <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Cancel current task, send this message</Typography>
                  </Box>
                </MenuItem>
                <MenuItem onClick={handleAddToQueue} sx={{ fontSize: '0.7rem', py: 0.75 }}>
                  <QueueIcon sx={{ fontSize: 14, mr: 1, color: colors.accent.blue }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 500 }}>Add to Queue</Typography>
                    <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Send after current task completes</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, ml: 'auto', pl: 1 }}>⌥Enter</Typography>
                </MenuItem>
                <MenuItem onClick={handleSteer} sx={{ fontSize: '0.7rem', py: 0.75 }}>
                  <RouteIcon sx={{ fontSize: 14, mr: 1, color: colors.accent.orange }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 500 }}>Steer with Message</Typography>
                    <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Redirect agent mid-task</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, ml: 'auto', pl: 1 }}>Enter</Typography>
                </MenuItem>
              </Menu>
            </Box>

            {/* Toolbar row */}
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.5,
              borderTop: `1px solid ${colors.border.default}20`,
            }}>
              {/* Plus button for file attach */}
              <Tooltip title="Attach files" arrow>
                <IconButton size="small" onClick={() => fileInputRef.current?.click()} sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.text.secondary } }}>
                  <AddIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>

              {/* Agent Mode */}
              <Tooltip title={agentMode === 'agent' ? 'Agent — full access, executes tools freely' : 'Plan — outlines steps, no write access'} arrow>
                <Chip
                  size="small"
                  label={agentMode === 'agent' ? 'Agent' : 'Plan'}
                  onClick={(e) => setModeMenuAnchor(e.currentTarget)}
                  sx={{
                    fontSize: '0.55rem', height: 20, cursor: 'pointer',
                    bgcolor: agentMode === 'agent' ? colors.accent.orange + '12' : colors.bg.tertiary,
                    border: `1px solid ${agentMode === 'agent' ? colors.accent.orange + '30' : colors.border.default}`,
                    borderRadius: '10px',
                    color: agentMode === 'agent' ? colors.accent.orange : colors.text.secondary,
                    '&:hover': { bgcolor: agentMode === 'agent' ? colors.accent.orange + '20' : colors.bg.primary },
                  }}
                />
              </Tooltip>

              <Menu anchorEl={modeMenuAnchor} open={Boolean(modeMenuAnchor)} onClose={() => setModeMenuAnchor(null)}
                PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 220 } }}>
                <MenuItem onClick={() => { setAgentMode('agent'); sessionSettings.setMode('agent').catch(() => {}); setModeMenuAnchor(null); }}
                  selected={agentMode === 'agent'} sx={{ fontSize: '0.7rem', py: 0.75, borderLeft: agentMode === 'agent' ? `3px solid ${colors.accent.orange}` : '3px solid transparent' }}>
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.accent.orange }}>Agent</Typography>
                    <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Full access — executes tools freely</Typography>
                  </Box>
                </MenuItem>
                <MenuItem onClick={() => { setAgentMode('plan'); sessionSettings.setMode('plan').catch(() => {}); setModeMenuAnchor(null); }}
                  selected={agentMode === 'plan'} sx={{ fontSize: '0.7rem', py: 0.75, borderLeft: agentMode === 'plan' ? `3px solid ${colors.text.secondary}` : '3px solid transparent' }}>
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.text.secondary }}>Plan</Typography>
                    <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Outlines steps — no write access</Typography>
                  </Box>
                </MenuItem>
              </Menu>

              {/* Provider Profile */}
              <Tooltip title="Provider Profile" arrow>
                <Chip
                  size="small"
                  label={(() => { const p = providerList.find(pr => pr.id === currentProvider); return p?.label || currentProvider || 'Provider'; })()}
                  onClick={(e) => setProviderMenuAnchor(e.currentTarget)}
                  sx={{
                    fontSize: '0.55rem', height: 20, cursor: 'pointer',
                    bgcolor: 'transparent', border: 'none',
                    color: currentProvider ? colors.text.secondary : colors.text.dim,
                    '&:hover': { bgcolor: colors.bg.primary },
                  }}
                />
              </Tooltip>

              <Menu anchorEl={providerMenuAnchor} open={Boolean(providerMenuAnchor)} onClose={() => setProviderMenuAnchor(null)}
                PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200 } }}>
                {providerList.filter(Boolean).map((profile) => (
                  <MenuItem key={profile.id} onClick={() => {
                    setCurrentProvider(profile.id);
                    setCurrentModel('');
                    setModelList([]);
                    providers.switchProfile(profile.providerId, profile.id).catch(() => {});
                    setProviderMenuAnchor(null);
                  }} selected={profile.id === currentProvider} sx={{ fontSize: '0.7rem' }}>
                    <Box>
                      <Typography sx={{ fontSize: '0.7rem' }}>{profile.label}</Typography>
                      <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>{profile.providerId}</Typography>
                    </Box>
                  </MenuItem>
                ))}
                {providerList.length === 0 && (
                  <MenuItem disabled sx={{ fontSize: '0.65rem', color: colors.text.dim }}>No providers configured</MenuItem>
                )}
              </Menu>

              {/* Model */}
              <Tooltip title="Model" arrow>
                <Chip
                  size="small"
                  label={currentModel || 'Model'}
                  onClick={(e) => setModelMenuAnchor(e.currentTarget)}
                    sx={{
                      fontSize: '0.55rem', height: 20, cursor: 'pointer',
                      bgcolor: 'transparent', border: 'none',
                      color: currentModel ? colors.accent.blue : colors.text.dim,
                      '&:hover': { bgcolor: colors.bg.primary },
                  }}
                />
              </Tooltip>

              <Menu anchorEl={modelMenuAnchor} open={Boolean(modelMenuAnchor)} onClose={() => setModelMenuAnchor(null)}
                PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200, maxHeight: 300 } }}>
                {loadingModels && <MenuItem disabled sx={{ fontSize: '0.65rem' }}><CircularProgress size={12} sx={{ mr: 1 }} />Loading...</MenuItem>}
                {!loadingModels && modelList.length === 0 && (
                  <MenuItem disabled sx={{ fontSize: '0.65rem', color: colors.text.dim }}>
                    {currentProvider ? 'No models found' : 'Select a provider first'}
                  </MenuItem>
                )}
                {modelList.filter(Boolean).map((m) => {
                    const caps = m.capabilities ?? [];
                    const hasFC = caps.includes('function_calling');
                    const hasVision = caps.includes('vision');
                    const hasReasoning = caps.includes('reasoning');
                    const hasJson = caps.includes('json_mode');
                    return (
                    <MenuItem key={m.id} onClick={() => {
                      setCurrentModel(m.id);
                      if (m.contextWindow) setTokenTotal(m.contextWindow);
                      const profile = providerList.find(p => p.id === currentProvider);
                      const providerId = profile?.providerId || currentProvider;
                      if (m.providerId && m.providerId !== providerId) {
                        setCurrentProvider(m.providerId);
                        providers.switch(m.providerId).then(() => {
                          models.switch(m.id).catch(() => {});
                        }).catch(() => {});
                      } else {
                        models.switch(m.id).catch(() => {});
                      }
                      setModelMenuAnchor(null);
                    }} selected={m.id === currentModel} sx={{ fontSize: '0.65rem' }}>
                      <Box sx={{ width: '100%' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography sx={{ fontSize: '0.65rem', fontWeight: m.id === currentModel ? 600 : 400 }}>{m.name || m.id}</Typography>
                          {hasFC && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.blue, bgcolor: '#58a6ff18', px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>FC</Typography>}
                          {hasVision && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.green, bgcolor: '#3fb95018', px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>V</Typography>}
                          {hasReasoning && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.purple, bgcolor: '#bc8cff18', px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>R</Typography>}
                          {hasJson && <Typography sx={{ fontSize: '0.45rem', color: colors.accent.cyan, bgcolor: '#39d35318', px: 0.4, py: 0.05, borderRadius: 0.5, fontWeight: 600 }}>JSON</Typography>}
                        </Box>
                        {m.contextWindow && <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>{(m.contextWindow / 1000).toFixed(0)}k context</Typography>}
                      </Box>
                    </MenuItem>
                    );
                  })}
              </Menu>

              {/* Spacer */}
              <Box sx={{ flex: 1 }} />

              {/* CWD — click to copy */}
              {cwd && (
                <Tooltip title={cwd} arrow>
                  <Typography
                    onClick={() => { navigator.clipboard.writeText(cwd).catch(() => {}); }}
                    sx={{
                      fontSize: '0.45rem', color: colors.text.dim,
                      fontFamily: "'JetBrains Mono', monospace",
                      maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      cursor: 'pointer', '&:hover': { color: colors.text.secondary },
                    }}
                  >
                    {cwd.split('/').slice(-2).join('/')}
                  </Typography>
                </Tooltip>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* ─── Right sidebar ─── */}
      <Box sx={{
        width: '15%', minWidth: 220, flexShrink: 0, borderLeft: `1px solid ${colors.border.default}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Crew (fixed for session) */}
        <Box sx={{ p: 1.5, borderBottom: `1px solid ${colors.border.default}` }}>
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', mb: 0.5 }}>
            CREW
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', color: colors.accent.purple, fontWeight: 500 }}>
            Agent-X
          </Typography>
          {crewList.length > 1 && (
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, mt: 0.25 }}>
              Fixed for this session
            </Typography>
          )}
        </Box>

        {/* Token usage */}
        <Box sx={{ p: 1.5, borderBottom: `1px solid ${colors.border.default}` }}>
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', mb: 0.75 }}>
            TOKEN USAGE
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.primary }}>
              {tokenUsed.toLocaleString()}
            </Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
              / {tokenTotal.toLocaleString()}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={tokenPercent}
            sx={{
              height: 3, borderRadius: 2, bgcolor: colors.bg.tertiary,
              '& .MuiLinearProgress-bar': {
                bgcolor: tokenPercent > 80 ? colors.accent.red : tokenPercent > 50 ? colors.accent.orange : colors.accent.blue,
              },
            }}
          />
          <Box sx={{ mt: 0.75, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>In / Out</Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
              {tokenInput.toLocaleString()} / {tokenOutput.toLocaleString()}
            </Typography>
          </Box>
          <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Compactions</Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: compactionCount > 0 ? colors.accent.orange : colors.text.secondary }}>
              {compactionCount}
            </Typography>
          </Box>
          {(tokenInputPrice > 0 || tokenOutputPrice > 0) && (
          <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Cost</Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
              ~${((tokenInput * tokenInputPrice + tokenOutput * tokenOutputPrice) / 1000000).toFixed(4)}
            </Typography>
          </Box>
          )}

          {currentSessionId && (
            <Box sx={{ mt: 1, pt: 0.75, borderTop: `1px solid ${colors.border.subtle}` }}>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, letterSpacing: '0.5px' }}>SCOPE</Typography>
              <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, mt: 0.25, wordBreak: 'break-all', cursor: 'pointer', '&:hover': { color: colors.accent.blue } }}
                onClick={async () => {
                  pendingFolderActionRef.current = 'changeCwd';
                  setFolderConsentOpen(true);
                }}>
                {cwd.split('/').slice(-3).join('/') || cwd}
              </Typography>
            </Box>
          )}
          {currentSessionId && (
            <Box sx={{ mt: 0.5, pt: 0.5, borderTop: `1px solid ${colors.border.subtle}` }}>
              <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, letterSpacing: '0.5px' }}>SESSION</Typography>
              <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, mt: 0.25, wordBreak: 'break-all' }}>
                {currentSessionId}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Tasks */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <ChecklistIcon sx={{ fontSize: 12, color: colors.accent.blue }} />
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px' }}>
              TASKS
            </Typography>
            <Box sx={{ flex: 1 }} />
            {todoItems.length > 0 && (
              <Chip size="small" label={`${todoItems.filter(t => t.status === 'completed').length}/${todoItems.length}`} sx={{ fontSize: '0.45rem', height: 15 }} />
            )}
          </Box>

          {todoItems.map((item) => (
            <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.3 }}>
              {item.status === 'completed' && <CheckCircleIcon sx={{ fontSize: 10, color: colors.accent.green }} />}
              {item.status === 'in-progress' && <PlayCircleIcon sx={{ fontSize: 10, color: colors.accent.orange }} />}
              {item.status === 'not-started' && <RadioButtonUncheckedIcon sx={{ fontSize: 10, color: colors.text.dim }} />}
              <Typography sx={{
                fontSize: '0.55rem', color: item.status === 'completed' ? colors.text.dim : colors.text.secondary,
                textDecoration: item.status === 'completed' ? 'line-through' : 'none',
                lineHeight: 1.3,
              }}>
                {item.title}
              </Typography>
            </Box>
          ))}

          {todoItems.length === 0 && (
            <Typography sx={{ color: colors.text.dim, fontSize: '0.55rem', textAlign: 'center', mt: 3 }}>
              No active tasks
            </Typography>
          )}
        </Box>
      </Box>
      </>)}

      {/* ─── Global enhancement modals ─── */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      <SessionSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPickSession={(sid) => { navigate(`/console/chat/${sid}`); }}
      />
      <CheckpointDrawer
        open={checkpointsOpen}
        onClose={() => setCheckpointsOpen(false)}
        sessionId={currentSessionId}
        onRestored={async () => {
          try {
            const h = await chat.history();
            const visible = h.filter(m => m.role !== 'system');
            setMessages(visible.map(m => ({ ...m, streaming: false })));
            const totalUsed = visible.reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            setTokenUsed(totalUsed);
            const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
            setTokenInput(inputEst);
            setTokenOutput(outputEst);
          } catch { /* ignore */ }
        }}
      />
      <FolderPickerModal
        open={folderPickerOpen}
        onSelect={(path) => {
          setFolderPickerOpen(false);
          folderPickerCallback?.(path);
          setFolderPickerCallback(null);
        }}
        onCancel={() => { setFolderPickerOpen(false); setFolderPickerCallback(null); }}
      />
      <Dialog
        open={folderConsentOpen}
        onClose={() => setFolderConsentOpen(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxWidth: 480, width: '90%' } }}
      >
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1 }}>
          BEFORE YOU START
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
            Agent-X will access the folder you select to read, create, and modify files as needed to complete your tasks.
          </Typography>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
            • Your files remain local — nothing is uploaded unless you explicitly use a tool that sends data to a provider.
          </Typography>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
            • Agent-X can run terminal commands and modify files within the selected directory. Review what tasks you delegate.
          </Typography>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7, mb: 1.5 }}>
            • You can change the working directory at any time from the sidebar.
          </Typography>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.75rem', lineHeight: 1.7 }}>
            • Switch between Agent (full autonomy with tool execution) and Plan (structured plan with step approval) modes in the toolbar.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setFolderConsentOpen(false)} sx={{ color: colors.text.dim, fontSize: '0.75rem' }}>
            Cancel
          </Button>
          <Button onClick={handleFolderConsentConfirm} variant="contained" sx={{ bgcolor: colors.text.primary, color: colors.bg.primary, fontSize: '0.75rem' }}>
            I Understand
          </Button>
        </DialogActions>
      </Dialog>
      {folderPickerLoading && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}>
          <CircularProgress size={40} sx={{ color: '#fff' }} />
        </Box>
      )}

    </Box>
  );
}

// ─── Thinking Indicator ───

function LoadingStepsIndicator({ steps }: { steps: Array<{ id: string; label: string; status: string }> }) {
  const label = steps[0]?.label ?? 'Working...';
  return (
    <Typography sx={{
      fontSize: '0.75rem',
      fontWeight: 500,
      background: `linear-gradient(90deg, ${colors.text.dim} 0%, ${colors.text.primary} 50%, ${colors.text.dim} 100%)`,
      backgroundSize: '200% 100%',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      animation: 'agentx-shimmer 2s infinite linear',
    }}>
      {label}
    </Typography>
  );
}

function ThinkingIndicator({ label }: { label?: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 2, animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: colors.accent.purple + '15', mt: 0.5, flexShrink: 0,
      }}>
        <SmartToyIcon sx={{ fontSize: 15, color: colors.accent.purple }} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
        {label ? (
          <LoadingStepsIndicator steps={[{ id: '', label, status: 'running' }]} />
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 0.4 }}>
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite' }} />
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.2s infinite' }} />
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.4s infinite' }} />
            </Box>
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontStyle: 'italic' }}>Thinking...</Typography>
          </>
        )}
      </Box>
    </Box>
  );
}

// ─── Message Bubble ───

// ─── Crew section rendering helpers ───
const CREW_PALETTE_WEB = [
  '#5B9BD5', '#70AD47', '#ED7D31', '#9B59B6',
  '#E74C3C', '#1ABC9C', '#F39C12', '#3498DB',
];

function getWebCrewColor(callsign: string): string {
  let hash = 0;
  for (let i = 0; i < callsign.length; i++) {
    hash = ((hash << 5) - hash) + callsign.charCodeAt(i);
    hash |= 0;
  }
  return CREW_PALETTE_WEB[Math.abs(hash) % CREW_PALETTE_WEB.length];
}

interface ContentSegment {
  type: 'normal' | 'crew';
  text: string;
  name?: string;
  callsign?: string;
}

function parseWebContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const headerRegex = /\n\n---\n\n(\*\*([^*]+)\*\*\s*\(@(\w+)\):\s*)/g;
  let lastEnd = 0;
  let match;

  while ((match = headerRegex.exec(content)) !== null) {
    if (match.index > lastEnd) {
      segments.push({ type: 'normal', text: content.slice(lastEnd, match.index) });
    }
    const headerEnd = match.index + match[0].length;
    const nextSep = content.indexOf('\n\n---\n\n', headerEnd);
    const crewText = nextSep >= 0 ? content.slice(headerEnd, nextSep) : content.slice(headerEnd);
    segments.push({ type: 'crew', text: crewText, name: match[2], callsign: match[3] });
    lastEnd = nextSep >= 0 ? nextSep : headerEnd + crewText.length;
  }

  if (lastEnd < content.length) {
    segments.push({ type: 'normal', text: content.slice(lastEnd) });
  }

  return segments;
}

const MARKDOWN_BASE_SX = {
  '& p': { m: 0, mb: 0.5, fontSize: '0.8rem', lineHeight: 1.6 },
  '& p:last-child': { mb: 0 },
  '& pre': { m: 0 },
  '& code': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem' },
  '& ul, & ol': { pl: 2.5, my: 0.5, fontSize: '0.8rem' },
  '& li': { mb: 0.25 },
  '& blockquote': { borderLeft: `3px solid ${colors.border.strong}`, pl: 1.5, ml: 0, my: 0.5, color: colors.text.secondary },
  '& a': { color: colors.accent.blue, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
};

const MAX_CODE_LINES = 30;

// Box-drawing and tree characters used in ASCII structural art (folder trees, diagrams)
const STRUCTURAL_CHARS = new Set([
  '├', '─', '│', '└', '┌', '┐', '┘', '┃', '┏', '┓', '┗', '┛',
  '╋', '╂', '┊', '┆', '═', '║', '╟', '╠', '╢', '╣', '╩', '╦',
  '╬', '▌', '▐', '▀', '▄', '█', '░', '▒', '▓',
]);

function isStructuralArt(text: string): boolean {
  const lines = text.split('\n');
  if (lines.length < 2) return false;
  const treeLineRe = /^[\s│├└┌┐┘┃┏┓┗┛╋╂╟╠╢╣╩╦╬+|\-`].*[─│└├┌┐┘║]/;
  let structuralCount = 0;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    // Check if line contains box-drawing chars
    let hasStructural = false;
    for (const ch of trimmed) {
      if (STRUCTURAL_CHARS.has(ch)) { hasStructural = true; break; }
    }
    // Also check common ASCII tree/diagram patterns
    if (!hasStructural && treeLineRe.test(trimmed)) hasStructural = true;
    // Check for indentation-heavy content (code-like)
    if (!hasStructural && /^[ \t]{2,}[\w\/\-.]/.test(trimmed)) hasStructural = true;
    if (hasStructural) structuralCount++;
  }
  // At least half the non-empty lines should look structural
  const nonEmpty = lines.filter(l => l.trim().length > 0).length;
  return nonEmpty >= 2 && structuralCount >= Math.ceil(nonEmpty / 2);
}

const CONTENT_TYPE: Record<string, { type: string; label: string }> = {
  ts: { type: 'Code', label: 'TypeScript' },
  tsx: { type: 'Code', label: 'TSX' },
  js: { type: 'Code', label: 'JavaScript' },
  jsx: { type: 'Code', label: 'JSX' },
  py: { type: 'Code', label: 'Python' },
  rs: { type: 'Code', label: 'Rust' },
  go: { type: 'Code', label: 'Go' },
  java: { type: 'Code', label: 'Java' },
  rb: { type: 'Code', label: 'Ruby' },
  php: { type: 'Code', label: 'PHP' },
  scala: { type: 'Code', label: 'Scala' },
  kt: { type: 'Code', label: 'Kotlin' },
  swift: { type: 'Code', label: 'Swift' },
  c: { type: 'Code', label: 'C' },
  cpp: { type: 'Code', label: 'C++' },
  cs: { type: 'Code', label: 'C#' },
  html: { type: 'Code', label: 'HTML' },
  css: { type: 'Code', label: 'CSS' },
  scss: { type: 'Code', label: 'SCSS' },
  less: { type: 'Code', label: 'Less' },
  json: { type: 'Config', label: 'JSON' },
  yaml: { type: 'Config', label: 'YAML' },
  yml: { type: 'Config', label: 'YAML' },
  toml: { type: 'Config', label: 'TOML' },
  xml: { type: 'Config', label: 'XML' },
  csv: { type: 'Config', label: 'CSV' },
  ini: { type: 'Config', label: 'INI' },
  env: { type: 'Config', label: '.env' },
  sh: { type: 'Shell', label: 'Shell' },
  bash: { type: 'Shell', label: 'Shell' },
  zsh: { type: 'Shell', label: 'Shell' },
  shell: { type: 'Shell', label: 'Shell' },
  powershell: { type: 'Shell', label: 'PowerShell' },
  ps1: { type: 'Shell', label: 'PowerShell' },
  sql: { type: 'SQL', label: 'SQL' },
  prompt: { type: 'Prompt', label: 'Prompt' },
  md: { type: 'Markdown', label: 'Markdown' },
  markdown: { type: 'Markdown', label: 'Markdown' },
  mdx: { type: 'Markdown', label: 'MDX' },
  diff: { type: 'Diff', label: 'Diff' },
  patch: { type: 'Diff', label: 'Patch' },
  graphql: { type: 'Code', label: 'GraphQL' },
  gql: { type: 'Code', label: 'GraphQL' },
  dockerfile: { type: 'Code', label: 'Dockerfile' },
  docker: { type: 'Code', label: 'Dockerfile' },
  makefile: { type: 'Code', label: 'Makefile' },
  cmake: { type: 'Code', label: 'CMake' },
  r: { type: 'Code', label: 'R' },
  dart: { type: 'Code', label: 'Dart' },
  lua: { type: 'Code', label: 'Lua' },
  elixir: { type: 'Code', label: 'Elixir' },
  erlang: { type: 'Code', label: 'Erlang' },
  haskell: { type: 'Code', label: 'Haskell' },
  clojure: { type: 'Code', label: 'Clojure' },
  solidity: { type: 'Code', label: 'Solidity' },
  nix: { type: 'Config', label: 'Nix' },
  terraform: { type: 'Config', label: 'Terraform' },
  tf: { type: 'Config', label: 'Terraform' },
  hcl: { type: 'Config', label: 'HCL' },
  text: { type: 'Text', label: 'Text' },
  plain: { type: 'Text', label: 'Text' },
};

function CodeBlockWithCopy({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const meta = (language ? CONTENT_TYPE[language.toLowerCase()] : null) || { type: 'Code', label: language || 'Text' };

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Box sx={{ my: 1, border: `1px solid ${colors.border.default}`, borderRadius: 1, overflow: 'hidden' }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 1.25, py: 0.45,
        bgcolor: colors.bg.secondary,
        borderBottom: `1px solid ${colors.border.default}`,
      }}>
        <Typography sx={{
          fontSize: '0.55rem', fontWeight: 700,
          color: colors.accent.blue,
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.4px',
        }}>
          {meta.type}{meta.label !== meta.type.toLowerCase() ? ` · ${meta.label}` : ''}
        </Typography>
        <Box component="button" onClick={handleCopy}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.4,
            bgcolor: 'transparent', border: `1px solid ${colors.border.subtle}`, borderRadius: '4px',
            cursor: 'pointer', px: 0.75, py: 0.15,
            color: copied ? colors.accent.green : colors.text.dim,
            fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace",
            transition: 'all 0.15s',
            '&:hover': {
              color: copied ? colors.accent.green : colors.text.secondary,
              borderColor: colors.text.dim,
            },
          }}>
          {copied ? '✓ Copied' : 'Copy'}
        </Box>
      </Box>
      <SyntaxHighlighter style={oneDark} language={language || 'text'} PreTag="div"
        customStyle={{ borderRadius: 0, fontSize: '0.7rem', margin: 0, padding: '10px 12px' }}>
        {code}
      </SyntaxHighlighter>
    </Box>
  );
}

function extractParagraphText(children: React.ReactNode): string {
  return React.Children.toArray(children).map(c => (typeof c === 'string' ? c : '')).join('');
}

const MARKDOWN_COMPONENTS = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className ?? '');
    let code = String(children).replace(/\n$/, '');
    const lines = code.split('\n');
    const truncated = lines.length > MAX_CODE_LINES;
    if (truncated) {
      code = lines.slice(0, MAX_CODE_LINES).join('\n') + `\n// … ${lines.length - MAX_CODE_LINES} more line${lines.length - MAX_CODE_LINES === 1 ? '' : 's'} truncated`;
    }
    if (match) {
      return <CodeBlockWithCopy code={code} language={match[1]} />;
    }
    if (truncated) {
      return <pre style={{ maxHeight: 200, overflow: 'auto', background: colors.bg.tertiary, borderRadius: 4, padding: '6px 10px', margin: '4px 0' }}><code className={className} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{code}</code></pre>;
    }
    return <code className={className} style={{ background: colors.bg.tertiary, padding: '1px 5px', borderRadius: 3, fontSize: '0.72rem' }} {...props}>{children}</code>;
  },
  p({ children, ...props }: any) {
    const text = extractParagraphText(children);
    if (isStructuralArt(text)) {
      return <CodeBlockWithCopy code={text} />;
    }
    return <p {...props}>{children}</p>;
  },
};

function UserMentionText({ content }: { content: string }) {
  const parts = content.split(/(@\w+)/g);
  return (
    <Typography sx={{ fontSize: '0.8rem', color: colors.text.primary, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((part, i) => {
        if (part.startsWith('@') && part.length > 1) {
          const callsign = part.slice(1);
          const color = callsign === 'agentx' ? colors.accent.blue : getWebCrewColor(callsign);
          return <Box key={i} component="span" sx={{ color, fontWeight: 600 }}>{part}</Box>;
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </Typography>
  );
}



function CrewAwareMarkdown({ content }: { content: string }) {
  const segments = parseWebContentSegments(content);
  const hasCrew = segments.some(s => s.type === 'crew');

  const cardSx = {
    bgcolor: colors.bg.elevated,
    border: `1px solid ${colors.border.subtle}`,
    borderRadius: 1.5,
    p: 1.75,
    my: 0.5,
    ...MARKDOWN_BASE_SX,
    '& p': {
      ...MARKDOWN_BASE_SX['& p'],
      color: colors.text.primary,
      fontSize: '0.75rem',
      lineHeight: 1.7,
    },
    '& hr': {
      border: 'none',
      height: 1,
      my: 1.5,
      bgcolor: colors.border.subtle,
      opacity: 0.4,
    },
    '& ul, & ol': {
      m: 0,
      pl: 2,
      fontSize: '0.75rem',
      lineHeight: 1.7,
    },
    '& li': {
      mb: 0.35,
      color: colors.text.primary,
    },
    '& li:last-child': { mb: 0 },
    '& li::marker': { color: colors.text.dim },
    '& input[type="checkbox"]': {
      accentColor: colors.accent.blue,
    },
  };

  if (!hasCrew) {
    return (
      <Box sx={cardSx}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
      </Box>
    );
  }

  return (
    <Box>
      {segments.map((seg, i) => {
        if (seg.type === 'crew' && seg.name && seg.callsign) {
          const cc = getWebCrewColor(seg.callsign);
          return (
            <Box key={i} sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: cc, mb: 0.25, letterSpacing: 0.3 }}>
                ◆ {seg.name} (@{seg.callsign})
              </Typography>
              <Box sx={{ ...cardSx, '& p': { ...cardSx['& p'], color: cc } } as any}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{seg.text}</ReactMarkdown>
              </Box>
            </Box>
          );
        }
        return (
          <Box key={i} sx={cardSx}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{seg.text}</ReactMarkdown>
          </Box>
        );
      })}
    </Box>
  );
}

function MessageBubble({ message, loadingSteps }: { message: UIMessage; loadingSteps?: Array<{ id: string; label: string; status: string }> | null }) {
  const isUser = message.role === 'user';
  const crewInfo = message.crew;
  const displayColor = crewInfo ? getWebCrewColor(crewInfo.callsign) : colors.accent.blue;

  if (message.role === 'system') return null;

  // User messages: right-aligned subtle card
  if (isUser) {
    return (
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end', animation: 'agentx-fadeIn 0.25s ease-out' }}>
        <Box sx={{ maxWidth: '72%', px: 1.5, py: 1, border: `1px solid ${colors.border.strong}`, borderRadius: 1.5, bgcolor: colors.bg.elevated }}>
          {message.attachments && message.attachments.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
              {message.attachments.map((a, i) => (<Chip key={i} size="small" icon={<InsertDriveFileIcon sx={{ fontSize: '11px !important' }} />} label={a.name} sx={{ fontSize: '0.5rem', height: 18, bgcolor: colors.accent.blue + '08', border: `1px solid ${colors.accent.blue}20` }} />))}
            </Box>
          )}
          <UserMentionText content={message.content} />
        </Box>
      </Box>
    );
  }

  // Assistant: flat chronological document — no bubble, no avatar
  return (
    <Box sx={{ mb: 3, animation: 'agentx-fadeIn 0.25s ease-out' }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: displayColor, fontFamily: "'JetBrains Mono', monospace", mb: 0.75, letterSpacing: '0.5px' }}>
        {crewInfo ? crewInfo.name : 'Agent-X'}
      </Typography>
      {message.thinking && (<ReasoningBlock text={message.thinking} streaming={message.streaming && !message.thinkingDoneAt} durationMs={message.thinkingDoneAt && message.thinkingStartedAt ? (message.thinkingDoneAt - message.thinkingStartedAt) : undefined} />)}
      {message.todos && message.todos.length > 0 && (<InlineTodoList items={message.todos} />)}

      {/* Chronological parts: text + tools interleaved in order of appearance */}
      {message.parts && message.parts.length > 0 ? (
        message.parts.map((part) => {
          switch (part.type) {
            case 'text':
              return part.content ? <CrewAwareMarkdown key={part.id} content={part.content} /> : null;
            case 'tool':
              return part.tool ? <Box key={part.id} sx={{ mt: 0.5 }}><ToolCardsGrouped tools={[part.tool] as any[]} /></Box> : null;
            case 'subagent':
              return part.agent ? (
                <Box key={part.id} sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  <SubAgentChip agent={part.agent as any} />
                </Box>
              ) : null;
            default:
              return null;
          }
        })
      ) : (
        // Fallback: render content + toolCalls the old way (for restored messages without parts)
        <>
          {message.content && <CrewAwareMarkdown content={message.content} />}
          {message.toolCalls && message.toolCalls.length > 0 && (<Box sx={{ mt: 0.75 }}><ToolCardsGrouped tools={message.toolCalls as any[]} /></Box>)}
          {message.subAgents && message.subAgents.length > 0 && (<Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>{message.subAgents.map((sa) => (<SubAgentChip key={sa.id} agent={sa as any} />))}</Box>)}
        </>
      )}

      {message.streaming && !message.content && !loadingSteps && (
        <Box sx={{ display: 'flex', gap: 0.4, py: 0.5 }}>{[0, 1, 2].map(i => (<Box key={i} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />))}</Box>
      )}
      {message.streaming && message.content && <Box component="span" sx={{ display: 'inline' }}><StreamingCursor /></Box>}
      {!message.streaming && (
        <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.75, opacity: 0.45 }}>
          {message.timestamp && <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Typography>}
          {message.turnTokens != null && <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>{message.turnTokens.toLocaleString()} tok</Typography>}
          <Box onClick={() => { navigator.clipboard.writeText(message.content).catch(() => {}); }} sx={{ cursor: 'pointer', display: 'flex', '&:hover': { opacity: 1 }, opacity: 0.7 }}><ContentCopyIcon sx={{ fontSize: 11, color: colors.text.dim }} /></Box>
        </Box>
      )}
      {message.streaming && message.content && (
        <Box sx={{ mt: 0.5, height: 2, borderRadius: 1, width: '50%', background: `linear-gradient(90deg, transparent, ${colors.accent.purple}50, transparent)`, backgroundSize: '200% 100%', animation: 'agentx-shimmer 1.5s infinite linear' }} />
      )}
    </Box>
  );
}

// ─── Tool Cards Grouped ───

function ToolCardsGrouped({ tools }: { tools: Array<{ id: string; name: string; status: string; args?: any; result?: string; elapsed?: number }> }) {
  const contextToolNames = new Set(['file_read', 'code_grep', 'code_search', 'file_find', 'folder_list', 'folder_tree', 'code_references', 'code_definitions']);
  const isContextTool = (t: typeof tools[number]) => contextToolNames.has(t.name);
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < tools.length) {
    if (isContextTool(tools[i])) {
      const group: typeof tools = [];
      while (i < tools.length && isContextTool(tools[i])) { group.push(tools[i]); i++; }
      elements.push(<ContextToolGroup key={group[0].id} tools={group} />);
    } else {
      elements.push(<ToolCallCard key={tools[i].id} tool={tools[i] as any} />);
      i++;
    }
  }
  return <Box>{elements}</Box>;
}

function ContextToolGroup({ tools }: { tools: Array<{ id: string; name: string; status: string; args?: any; result?: string; elapsed?: number }> }) {
  const [expanded, setExpanded] = useState(false);
  const done = tools.filter(t => t.status === 'done' || t.status === 'error').length;
  const isComplete = done === tools.length;
  const parts: string[] = [];
  const reads = tools.filter(t => t.name.includes('read')).length;
  const searches = tools.filter(t => t.name.includes('grep') || t.name.includes('search') || t.name.includes('find')).length;
  const lists = tools.filter(t => t.name.includes('list') || t.name.includes('tree')).length;
  if (reads > 0) parts.push(`${reads} read${reads > 1 ? 's' : ''}`);
  if (searches > 0) parts.push(`${searches} search${searches > 1 ? 'es' : ''}`);
  if (lists > 0) parts.push(`${lists} folder${lists > 1 ? 's' : ''}`);
  return (
    <Box sx={{ mb: 0.5, borderRadius: 1, border: `1px solid ${colors.accent.blue}25`, bgcolor: colors.accent.blue + '06', overflow: 'hidden' }}>
      <Box onClick={() => isComplete && setExpanded(e => !e)} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.625, cursor: isComplete ? 'pointer' : 'default', '&:hover': isComplete ? { bgcolor: colors.accent.blue + '0A' } : {} }}>
        <Box sx={{ display: 'flex', gap: 0.3 }}>{tools.map((t, i) => (<Box key={i} sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: t.status === 'running' ? colors.accent.blue : t.status === 'error' ? colors.accent.red : colors.accent.green }} />))}</Box>
        <SearchIcon sx={{ fontSize: 14, color: colors.accent.blue }} />
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 500, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>{isComplete ? 'Gathered context' : 'Gathering context...'}</Typography>
        <Typography sx={{ fontSize: '0.55rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace" }}>{parts.join(', ')}</Typography>
        <Box sx={{ flex: 1 }} />
        {isComplete && <KeyboardArrowDownIcon sx={{ fontSize: 14, color: colors.text.dim, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />}
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1.25, pb: 1, pt: 0.25, borderTop: `1px solid ${colors.accent.blue}15` }}>{tools.map(t => (<ToolCallCard key={t.id} tool={t as any} />))}</Box>
      </Collapse>
    </Box>
  );
}

// ─── Sub-Agent Chip ───

function SubAgentChip({ agent }: { agent: SubAgent }) {
  return (
    <Chip size="small"
      icon={agent.status === 'running' ? <CircularProgress size={10} sx={{ color: 'inherit' }} /> : <AccountTreeIcon sx={{ fontSize: 11 }} />}
      label={`${agent.name}: ${agent.task.slice(0, 35)}${agent.task.length > 35 ? '…' : ''}`}
      sx={{
        fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", height: 20,
        bgcolor: agent.status === 'running' ? colors.accent.purple + '10' : colors.accent.green + '10',
        border: `1px solid ${agent.status === 'running' ? colors.accent.purple : colors.accent.green}20`,
        color: agent.status === 'running' ? colors.accent.purple : colors.accent.green,
      }}
    />
  );
}

// ─── Inline Todo List ───

function InlineTodoList({ items }: { items: TodoItem[] }) {
  return (
    <Box sx={{ mb: 0.75, p: 1, borderRadius: 1, border: `1px solid ${colors.border.default}`, bgcolor: colors.bg.tertiary }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <ChecklistIcon sx={{ fontSize: 12, color: colors.accent.blue }} />
        <Typography sx={{ fontSize: '0.55rem', fontWeight: 600, color: colors.accent.blue }}>Tasks</Typography>
      </Box>
      {items.map((item) => (
        <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.2 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: item.status === 'completed' ? colors.accent.green : item.status === 'in-progress' ? colors.accent.orange : colors.text.dim, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.55rem', color: item.status === 'completed' ? colors.text.dim : colors.text.secondary, textDecoration: item.status === 'completed' ? 'line-through' : 'none' }}>
            {item.title}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// ─── Permission Banner ───

function PermissionBanner({ prompt, onRespond }: { prompt: { tool: string; path: string; riskLevel: string }; onRespond: () => void }) {
  const handleRespond = async (choice: 'allow_once' | 'allow_always' | 'deny') => {
    try {
      await fetch('/api/permission/respond', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) });
    } catch { /* ignore */ }
    onRespond();
  };

  const isCritical = prompt.riskLevel === 'critical';
  const isHigh = prompt.riskLevel === 'high';
  const borderColor = isCritical ? colors.accent.red + '50' : isHigh ? colors.accent.orange + '40' : colors.accent.orange + '30';

  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, border: `1px solid ${borderColor}`, bgcolor: colors.bg.secondary, animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.blue }}>
          {isCritical ? '⚠ Critical' : isHigh ? '⚡ High Risk' : 'Permission Required'}
        </Typography>
        <Chip size="small" label={prompt.riskLevel.toUpperCase()} sx={{
          fontSize: '0.45rem', height: 15, fontWeight: 600,
          bgcolor: isCritical ? colors.accent.red + '20' : isHigh ? colors.accent.orange + '20' : colors.accent.blue + '15',
          color: isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.blue,
        }} />
      </Box>
      <Typography sx={{ fontSize: '0.6rem', mb: 0.5, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
        {prompt.tool}
      </Typography>
      {prompt.path && (
        <Typography sx={{ fontSize: '0.55rem', mb: 0.75, color: colors.text.dim, wordBreak: 'break-all' }}>
          {prompt.path}
        </Typography>
      )}
      {isCritical && (
        <Typography sx={{ fontSize: '0.5rem', mb: 0.75, color: colors.accent.red, fontStyle: 'italic' }}>
          This operation could permanently affect your system. Review carefully before allowing.
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        <Chip size="small" label="Allow Once" onClick={() => handleRespond('allow_once')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.green + '15', color: colors.accent.green, '&:hover': { bgcolor: colors.accent.green + '30' } }} />
        <Chip size="small" label="Always" onClick={() => handleRespond('allow_always')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.blue + '15', color: colors.accent.blue, '&:hover': { bgcolor: colors.accent.blue + '30' } }} />
        <Chip size="small" label="Deny" onClick={() => handleRespond('deny')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.red + '15', color: colors.accent.red, '&:hover': { bgcolor: colors.accent.red + '30' } }} />
      </Box>
    </Box>
  );
}

// ─── Tool Enable Banner ───

function ToolEnableBanner({ toolId, toolName, onRespond }: { toolId: string; toolName: string; onRespond: () => void }) {
  const handleEnable = async () => {
    try { await tools.toggle(toolId, true); } catch { /* ignore */ }
    onRespond();
  };

  return (
    <Box sx={{ p: 1.5, mb: 2, borderRadius: 1, border: `1px solid ${colors.accent.purple}30`, bgcolor: colors.accent.purple + '05', animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.accent.purple, mb: 0.5 }}>Tool Disabled</Typography>
      <Typography sx={{ fontSize: '0.6rem', mb: 1, color: colors.text.secondary }}>
        The agent needs <strong>{toolName}</strong> but it&apos;s disabled.
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        <Chip size="small" label="Enable" onClick={handleEnable} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.green + '12', color: colors.accent.green, '&:hover': { bgcolor: colors.accent.green + '25' } }} />
        <Chip size="small" label="Keep Disabled" onClick={onRespond} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.red + '12', color: colors.accent.red, '&:hover': { bgcolor: colors.accent.red + '25' } }} />
      </Box>
    </Box>
  );
}
