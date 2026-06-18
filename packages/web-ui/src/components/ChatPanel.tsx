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
import ArticleIcon from '@mui/icons-material/Article';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
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
import { InlineToolCall } from './InlineToolCall';
import { StyledTableWrapper, StyledUl, StyledOl, StyledLi } from './StructuredViews';

// ─── CSS Keyframes (injected once) ───
const styleId = 'agentx-chat-keyframes';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes agentx-pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }
    @keyframes agentx-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes agentx-fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes agentx-scanlines {
      0% { transform: translateY(0); }
      100% { transform: translateY(4px); }
    }
    @keyframes agentx-flicker {
      0%, 100% { opacity: 0.2; }
      15% { opacity: 0.7; }
      30% { opacity: 0.1; }
      45% { opacity: 0.8; }
      60% { opacity: 0.2; }
      75% { opacity: 0.6; }
      90% { opacity: 0.3; }
    }
    @keyframes agentx-hyperdrive-glow {
      0%, 100% { box-shadow: 0 0 5px #ff00ff40; border-color: #ff00ff30; }
      25% { box-shadow: 0 0 12px #ff00ff60, 0 0 20px #ff00ff20; border-color: #ff00ff50; }
      50% { box-shadow: 0 0 8px #ff00ff40, 0 0 15px #00ffff20; border-color: #ff00ff30; }
      75% { box-shadow: 0 0 14px #ff00ff50, 0 0 25px #ff00ff30; border-color: #ff00ff60; }
    }
    @keyframes agentx-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
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

  crew?: { crewId: string; name: string; callsign: string; color?: string; icon?: string; confidence?: string; reasons?: string[] };
  parts?: PartEntry[];
  isModeChange?: { from: string; to: string };
}

function parseModeChange(content?: string): { from: string; to: string } | null {
  if (!content) return null;
  const match = content.match(/^\[MODE_CHANGE\]\s*(\w+)\s*→\s*(\w+)/);
  if (!match) return null;
  return { from: match[1]!, to: match[2]! };
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
  streamOutput?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: number;
}

interface SubAgent {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  toolCalls?: ToolCall[];
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
  const [parentSessionId, setParentSessionId] = useState<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [permissionPrompt, setPermissionPrompt] = useState<{ requestId: string; tool: string; path: string; riskLevel: string } | null>(null);
  const [pendingPermissionCount, setPendingPermissionCount] = useState(0);
  const [toolEnablePrompt, setToolEnablePrompt] = useState<{ toolId: string; toolName: string } | null>(null);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const skipRestoreRef = useRef(false);
  const streamChunkRAFRef = useRef<number | null>(null);
  const streamChunkPendingRef = useRef<{ delta: string; fullContent: string } | null>(null);

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
  const rateLimitSeenRef = useRef(false);

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
      sessions.restore(sessionId).then(({ messages: historyMsgs, session, scopePath }) => {
        const resolvedScope = scopePath || session.scopePath;
        const visible = historyMsgs.filter((m: any) => m.role !== 'part');
        setMessages(visible.map((m: any) => {
          const modeChange = parseModeChange(m.content);
          return {
            ...m,
            id: m.id || crypto.randomUUID(),
            streaming: false,
            toolCalls: m.toolCalls?.map((tc: any) => ({ ...tc, status: 'done' as const })),
            subAgents: m.subAgents?.map((sa: any) => ({ ...sa, status: 'done' as const })),
            plan: typeof m.plan === 'string' ? JSON.parse(m.plan) : (m.plan || undefined),
            ...(modeChange ? { isModeChange: modeChange } : {}),
          };
        }) as unknown as UIMessage[]);
        setCurrentSessionTitle(session.title ?? `Session ${sessionId.slice(0, 8)}`);
        setParentSessionId(session.parentId ?? null);
        const totalUsed = (session as any).tokenUsed ?? session.tokensUsed ?? 0;
        setTokenUsed(totalUsed);
        const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        setTokenInput(inputEst);
        setTokenOutput(outputEst);
        if (resolvedScope) setCwd(resolvedScope);
        // Restore saved session mode from DB (do not re-send to server)
        if (session.mode === 'plan' || session.mode === 'agent') {
          setAgentMode(session.mode);
        }
        loadTodos();
      }).catch((err) => {
        console.error('Failed to restore session on mount:', err);
        setWarnings([`Failed to restore session: ${err instanceof Error ? err.message : 'Unknown error'}`]);
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

  // Collapsible sidebar sections
  const [contextExpanded, setContextExpanded] = useState(false);
  const [tokenExpanded, setTokenExpanded] = useState(true);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [contextData, setContextData] = useState('');
  const [rebuildingContext, setRebuildingContext] = useState(false);

  const handleRebuildContext = useCallback(async () => {
    if (!currentSessionId || rebuildingContext) return;
    setRebuildingContext(true);
    try {
      const r = await fetch(`/api/sessions/${currentSessionId}/context/rebuild`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (d.ok) {
        // Refresh context data after rebuild
        fetch(`/api/sessions/${currentSessionId}/context`, { credentials: 'include' })
          .then(r2 => r2.json())
          .then(d2 => { if (d2.context) setContextData(d2.context); })
          .catch(() => {});
      }
    } catch { /* ignore */ }
    setRebuildingContext(false);
  }, [currentSessionId, rebuildingContext]);

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

  // Hyperdrive — full autonomous mode
  const [hyperdriveMode, setHyperdriveMode] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  // Hyperdrive shimmer — random interval flash sweep across the chip
  const [hyperdriveShimmer, setHyperdriveShimmer] = useState(false);
  useEffect(() => {
    if (hyperdriveMode) { setHyperdriveShimmer(false); return; }
    const trigger = () => {
      setHyperdriveShimmer(true);
      setTimeout(() => setHyperdriveShimmer(false), 800);
    };
    const nextInterval = () => 3000 + Math.random() * 7000;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(() => { trigger(); schedule(); }, nextInterval()); };
    schedule();
    return () => clearTimeout(timer);
  }, [hyperdriveMode]);  

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

  // RAF-batched tool event accumulator (prevents render storm on long-running tasks)
  const toolBatchRef = useRef<TelemetryEvent[]>([]);
  const toolFlushRef = useRef<number | null>(null);

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

  // Auto-scroll only when user is at bottom — only count user/assistant messages
  const prevRealCountRef = useRef(0);
  useEffect(() => {
    const realMsgs = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    if (realMsgs.length <= prevRealCountRef.current) return;
    prevRealCountRef.current = realMsgs.length;
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
    system.cwd().then((r) => { if (r.cwd) setCwd(r.cwd); }).catch(() => {});
    sessionSettings.get().then((s) => { if (s.mode === 'agent' || s.mode === 'plan') setAgentMode(s.mode); }).catch(() => {});
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


    // Pure function to apply a single tool event to messages state (used by RAF batch)
    const applyToolEvent = (prev: UIMessage[], ev: TelemetryEvent): UIMessage[] => {
      const last = prev[prev.length - 1];
      if (last?.role !== 'assistant') return prev;
      switch (ev.type) {
        case 'tool_executing': {
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
          return updateLastMessage(prev, { toolCalls: [...(last.toolCalls ?? []), tc], parts: [...(last.parts || []), toolPart] });
        }
        case 'tool_output': {
          const outputCallId = (ev.callId as string) ?? '';
          const outputText = (ev.output as string) ?? '';
          if (!outputCallId || !outputText) return prev;
          const newParts = (last.parts || []).map((p: PartEntry) =>
            p.type === 'tool' && p.tool?.id === outputCallId && p.tool?.status === 'running'
              ? { ...p, tool: { ...p.tool, streamOutput: (p.tool.streamOutput || '') + outputText } } : p);
          const newToolCalls = (last.toolCalls || []).map((t: ToolCall) =>
            t.id === outputCallId && t.status === 'running'
              ? { ...t, streamOutput: (t.streamOutput || '') + outputText } : t);
          return updateLastMessage(prev, { toolCalls: newToolCalls, parts: newParts });
        }
        case 'tool_complete': {
          const toolName = (ev.tool as string) ?? '';
          const elapsed = (ev.elapsed as number) ?? 0;
          const callId = (ev.callId as string) ?? '';
          const result = (ev as any).result ?? (ev as any).output as string ?? '';
          const resultStr = typeof result === 'string' ? result
            : (result && typeof result === 'object' ? ((result as any).output || (result as any).message || JSON.stringify(result)) : '');
          if (toolName === 'delegate_to_subagent' && last.subAgents) {
            const newSubAgents = last.subAgents.map((a: SubAgent) =>
              a.status !== 'running' ? a : { ...a, status: 'done' as const, result: resultStr });
            const newParts = (last.parts || []).map((p: PartEntry) =>
              p.type === 'subagent' && p.agent?.id === callId
                ? { ...p, agent: { ...p.agent!, status: 'done' as const, result: resultStr } } : p);
            return updateLastMessage(prev, { subAgents: newSubAgents, parts: newParts });
          }
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
          const resObj = typeof (ev as any).result === 'object' && (ev as any).result !== null ? (ev as any).result as Record<string, unknown> : null;
          if (resObj?.error === 'TOOL_NOT_FOUND' || resObj?.error === 'NO_HANDLER') setToolEnablePrompt({ toolId: toolName, toolName });
          return updateLastMessage(prev, { toolCalls: newToolCalls, parts: newParts });
        }
        default:
          return prev;
      }
    };

    const handleEvent = (ev: TelemetryEvent) => {
      // Reset activity timer on every event from the agent
      lastActivityRef.current = Date.now();
      setLastEventAt(Date.now());

      // RAF-batch high-frequency tool events to prevent render storm on long-running tasks
      if (ev.type === 'tool_executing' || ev.type === 'tool_output' || ev.type === 'tool_complete') {
        toolBatchRef.current.push(ev);
        if (toolFlushRef.current === null) {
          toolFlushRef.current = requestAnimationFrame(() => {
            toolFlushRef.current = null;
            const batch = toolBatchRef.current;
            toolBatchRef.current = [];
            if (batch.length === 0) return;
            setMessages(prev => {
              let current = prev;
              for (const e of batch) {
                current = applyToolEvent(current, e);
              }
              return current;
            });
          });
        }
        return;
      }

      setMessages((prev) => {
        const last = prev[prev.length - 1];

        switch (ev.type) {
          case 'loading_start': {
            streamChunkPendingRef.current = null;
            if (streamChunkRAFRef.current !== null) {
              cancelAnimationFrame(streamChunkRAFRef.current);
              streamChunkRAFRef.current = null;
            }
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
              const step = { id: ev.stepId as string, label: ev.label as string, status: ev.status as string };
              if (!prevSteps) return [step];
              const exists = prevSteps.some(s => s.id === step.id);
              if (!exists) return [...prevSteps, step];
              return prevSteps.map((s) =>
                s.id === ev.stepId ? { ...s, status: ev.status as string } : s,
              );
            });
            return prev;

          case 'stream_chunk': {
            const delta = (ev.content as string) ?? '';
            const fullContent = (ev.fullContent as string) ?? '';
            if (last?.role === 'assistant' && last.streaming) {
              const pending = streamChunkPendingRef.current;
              streamChunkPendingRef.current = {
                delta: pending ? pending.delta + delta : delta,
                fullContent,
              };
              if (streamChunkRAFRef.current === null) {
                streamChunkRAFRef.current = requestAnimationFrame(() => {
                  streamChunkRAFRef.current = null;
                  const chunk = streamChunkPendingRef.current;
                  if (!chunk) return;
                  streamChunkPendingRef.current = null;
                  setMessages(p => {
                    const l = p[p.length - 1];
                    if (l?.role !== 'assistant' || !l.streaming) return p;
                    const parts = l.parts || [];
                    const lastPart = parts[parts.length - 1];
                    if (lastPart?.type === 'text') {
                      const updatedParts = [...parts.slice(0, -1), { ...lastPart, content: (lastPart.content || '') + chunk.delta }];
                      return updateLastMessage(p, { content: chunk.fullContent, parts: updatedParts });
                    }
                    const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: chunk.delta };
                    return updateLastMessage(p, { content: chunk.fullContent, parts: [...parts, textPart] });
                  });
                });
              }
              return prev;
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
                // Merge final content from server (may be more complete than streamed content)
                const mergedText = text.length > (last.content || '').length ? text : (last.content || '');
                return updateLastMessage(prev, { content: mergedText, streaming: false, ...(crew ? { crew } : {}) });
              }
              return updateLastMessage(prev, { streaming: false, ...(crew ? { crew } : {}) });
            }
            if (msg.role === 'assistant' && text) {
              const parts = msg.parts || (last?.parts) || [{ type: 'text' as const, id: crypto.randomUUID(), content: text }];
              return [...prev, { id: msg.id || crypto.randomUUID(), role: 'assistant' as const, content: text, streaming: false, parts, ...(crew ? { crew } : {}) } as UIMessage];
            }
            return prev;
          }

          case 'permission_required':
            setPendingPermissionCount((prev) => prev + 1);
            setPermissionPrompt({
              requestId: (ev.requestId as string) ?? `${ev.tool}-${Date.now()}`,
              tool: (ev.tool as string) ?? 'unknown',
              path: (ev.path as string) ?? '',
              riskLevel: (ev.riskLevel as string) ?? 'medium',
            });
            return prev;

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

          case 'provider_error': {
            const providerMsg = (ev.message as string) ?? 'Provider error';
            const msg = extractProviderError(providerMsg);
            // Rate-limit errors suppress all subsequent warnings for this turn
            if (/rate.?limit|429|too many requests|quota/i.test(providerMsg)) {
              rateLimitSeenRef.current = true;
            }
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
            // Suppress cascaded errors after a rate-limit — only show the first warning
            if (rateLimitSeenRef.current) {
              setStreaming(false);
              return prev;
            }
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

          case 'plan_mode_entered':
            if (prev.length === 0) return prev; // skip default mode on fresh session
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: 'Agent', to: 'Plan' },
            }];

          case 'plan_mode_exited':
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: 'Plan', to: 'Agent' },
            }];

          case 'hyperdrive_entered':
            setAgentMode('agent');
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: (ev as any).wasPlan ? 'Plan' : 'Agent', to: 'Hyperdrive' },
            }];

          case 'hyperdrive_exited':
            setAgentMode((ev as any).mode);
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: 'Hyperdrive', to: (ev as any).wasPlan ? 'Plan' : 'Agent' },
            }];

          case 'subagent_event': {
            const subagentId = (ev as any).subagentId as string;
            const parentEvent = (ev as any).parentEvent as Record<string, unknown>;
            if (!subagentId || !parentEvent || !last?.subAgents) return prev;
            switch (parentEvent.type) {
              case 'tool_executing': {
                const toolName = (parentEvent.tool as string) ?? 'unknown';
                const desc = (parentEvent.description as string) ?? '';
                const eventArgs = parentEvent.args ?? desc;
                const callId = (parentEvent.callId as string) ?? crypto.randomUUID();
                const tc: ToolCall = { id: callId, name: toolName, args: eventArgs as any, status: 'running' };
                const newSubAgents = last.subAgents.map((a: SubAgent) =>
                  a.id !== subagentId ? a : { ...a, toolCalls: [...(a.toolCalls || []), tc] });
                return updateLastMessage(prev, { subAgents: newSubAgents });
              }
              case 'tool_output': {
                const outputCallId = (parentEvent.callId as string) ?? '';
                const outputText = (parentEvent.output as string) ?? '';
                if (!outputCallId || !outputText) return prev;
                const newSubAgents = last.subAgents.map((a: SubAgent) =>
                  a.id !== subagentId ? a : {
                    ...a,
                    toolCalls: (a.toolCalls || []).map((t: ToolCall) =>
                      t.id === outputCallId && t.status === 'running'
                        ? { ...t, streamOutput: (t.streamOutput || '') + outputText } : t),
                  });
                return updateLastMessage(prev, { subAgents: newSubAgents });
              }
              case 'tool_complete': {
                const toolName = (parentEvent.tool as string) ?? '';
                const elapsed = (parentEvent.elapsed as number) ?? 0;
                const callId = (parentEvent.callId as string) ?? '';
                const result = (parentEvent as any).result ?? (parentEvent as any).output ?? '';
                const resultStr = typeof result === 'string' ? result
                  : (result && typeof result === 'object' ? ((result as any).output || (result as any).message || JSON.stringify(result)) : '');
                const newSubAgents = last.subAgents.map((a: SubAgent) =>
                  a.id !== subagentId ? a : {
                    ...a,
                    toolCalls: (a.toolCalls || []).map((t: ToolCall) => {
                      if (callId && t.id !== callId) return t;
                      if (!callId && (t.name !== toolName || t.status !== 'running')) return t;
                      return { ...t, status: 'done' as const, result: resultStr, elapsed };
                    }),
                  });
                return updateLastMessage(prev, { subAgents: newSubAgents });
              }
              default:
                return prev;
            }
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
          // On reconnect, fetch current agent state to recover any missed updates
          fetch('/api/agent/state', { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
              if (data.processing) {
                setStreaming(true);
              }
            })
            .catch(() => {});
        }
      },
    });
    return () => {
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

  // Streaming timeout — tracks activity via SSE events.
  // - All SSE events (tool, chunk, status) reset the activity timer.
  // - After 2 minutes of inactivity, tries to recover the response from the API.
  // - Retries recovery every tick until streaming ends or a complete response is found.
  // - Never force-closes streaming — the agent may be processing tools for minutes.
  const lastActivityRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!streaming) return;
    lastActivityRef.current = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed > 120000) {
        // 2 min inactivity — SSE may be disconnected. Try to recover by fetching
        // /api/chat/history. If the agent already produced a response, display it.
        // Keep retrying on every tick until streaming ends.
        fetch(`/api/chat/history`, { credentials: 'include' })
          .then(r => r.json())
          .then(data => {
            const msgs = Array.isArray(data) ? data : [];
            // Iterate backwards to find the most recent complete assistant response
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i];
              if (m.role === 'assistant' && m.content && !m.toolCalls) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role !== 'assistant') return prev;
                  // Only apply if our local content is shorter (stale/partial)
                  if (last.streaming || !last.content || last.content.length < m.content.length) {
                    return updateLastMessage(prev, { content: m.content, streaming: false });
                  }
                  return prev;
                });
                setStreaming(false);
                break;
              }
            }
          })
          .catch(() => {});
      }
    }, 15000);
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
    if (!cwd) {
      setWarnings(['Please select a working folder before starting a session.']);
      return null;
    }
    try {
      const result = await sessions.create(cwd);
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
    if ((!text && attachments.length === 0)) return;
    if (!currentProvider || !currentModel) return;
    rateLimitSeenRef.current = false;

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
      // Fallback: if SSE didn't deliver the response (e.g., connection dropped during streaming),
      // display the response from the API call directly. SSE should have already delivered the
      // content via message_received, but this handles edge cases where the event was lost.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          const fullContent = result?.message?.content || '';
          if (fullContent) {
            // Prefer the API response — it's guaranteed complete
            return [...prev.slice(0, -1), { ...result.message, streaming: false }];
          }
          // Empty content: clarification or no-op, remove the stale placeholder
          return prev.slice(0, -1);
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

  // ─── Hyperdrive toggle ───
  const handleHyperdriveToggle = useCallback(async () => {
    if (!hyperdriveMode) {
      setShowDisclaimer(true);
    } else {
      try {
        const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json();
        setHyperdriveMode(false);
        if (data.mode) setAgentMode(data.mode);
      } catch { /* ignore */ }
    }
  }, [hyperdriveMode]);

  const confirmHyperdrive = useCallback(async () => {
    setShowDisclaimer(false);
    try {
      const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      setHyperdriveMode(true);
      if (data.mode) setAgentMode(data.mode);
    } catch { /* ignore */ }
  }, []);

  // Check hyperdrive mode on mount
  useEffect(() => {
    fetch('/api/mode/hyperdrive', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.hyperdriveMode) setHyperdriveMode(true); })
      .catch(() => {});
  }, [currentSessionId]);

  // Refresh context data when session loads or changes
  useEffect(() => {
    if (!currentSessionId) return;
    const fetchContext = () => {
      fetch(`/api/sessions/${currentSessionId}/context`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => { if (d.context) setContextData(d.context); })
        .catch(() => {});
    };
    fetchContext();
    const interval = setInterval(fetchContext, 15000);
    return () => clearInterval(interval);
  }, [currentSessionId]);

  // Double-Esc ref for cancel
  const lastEscRef = useRef(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Tab') {
        // Block Tab in hyperdrive mode
        if (hyperdriveMode) return;
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
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (streaming) {
          handleCancel();
        } else {
          // Double-Esc within 500ms = cancel any active processing
          const now = Date.now();
          if (now - lastEscRef.current < 500) {
            handleCancel();
            lastEscRef.current = 0;
          } else {
            lastEscRef.current = now;
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentSessionId, streaming, messages, handleResend, view, handleToggleMode, hyperdriveMode]);

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
    rateLimitSeenRef.current = false;
    setStreaming(false);
    try {
      const { messages: historyMsgs, session, scopePath } = await sessions.restore(s.id);
      const visible = historyMsgs.filter((m: any) => m.role !== 'part');
      setMessages(visible.map((m: any) => {
        const modeChange = parseModeChange(m.content);
        return {
          ...m, id: m.id || crypto.randomUUID(), streaming: false,
          toolCalls: m.toolCalls?.map((tc: any) => ({ ...tc, status: 'done' as const })),
          subAgents: m.subAgents?.map((sa: any) => ({ ...sa, status: 'done' as const })),
          plan: typeof m.plan === 'string' ? JSON.parse(m.plan) : (m.plan || undefined),
          ...(modeChange ? { isModeChange: modeChange } : {}),
        };
      }) as unknown as UIMessage[]);
      setCurrentSessionTitle(s.title ?? `Session ${s.id.slice(0, 8)}`);
      setCurrentSessionId(s.id);
      setShowJumpPill(false);
      setUnreadCount(0);
      setTokenUsed(s.tokensUsed ?? 0);
      const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      setTokenInput(inputEst);
      setTokenOutput(outputEst);
      const restoredCwd = scopePath || session?.scopePath || '';
      if (restoredCwd) setCwd(restoredCwd);
      // Restore saved session mode from DB (do not re-send to server)
      if (session?.mode === 'plan' || session?.mode === 'agent') {
        setAgentMode(session.mode);
      }
      loadTodos();
      navigate(`/console/chat/${s.id}`);
    } catch (e) {
      setWarnings([`Failed to restore session: ${e instanceof Error ? e.message : 'Unknown error'}`]);
    }
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
    try {
      await system.setCwd(folder);
    } catch {
      setWarnings(['Failed to set working directory. Please try a different folder.']);
      return;
    }
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
  const visibleMessages = messages.filter((m) => {
    if (m.role === 'system' && !m.isModeChange) return false;
    if (m.role === 'assistant' && !m.content && !m.thinking && (!m.toolCalls || m.toolCalls.length === 0) && (!m.subAgents || m.subAgents.length === 0) && (!m.parts || m.parts.length === 0)) return false;
    return true;
  });

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
      <Box sx={{
        flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative',
        ...(hyperdriveMode ? {
          borderRadius: 2,
          transition: 'all 0.6s ease',
          '&::before': {
            content: '""',
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,0,255,0.03) 2px, rgba(255,0,255,0.03) 4px)',
            animation: 'agentx-scanlines 4s linear infinite',
            borderRadius: 'inherit',
          },
        } : {}),
      }}>
        {/* Hyperdrive cosmic particles background */}
        {hyperdriveMode && (
          <Box sx={{
            position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0,
            borderRadius: 'inherit',
          }}>
            {Array.from({ length: 30 }).map((_, i) => (
              <Box key={i} sx={{
                position: 'absolute',
                width: 1 + Math.random() * 2, height: 1 + Math.random() * 2,
                bgcolor: i % 3 === 0 ? '#ff00ff' : i % 3 === 1 ? '#00ffff' : '#ffffff',
                borderRadius: '50%',
                left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
                opacity: 0.3 + Math.random() * 0.7,
                animation: `agentx-flicker ${2 + Math.random() * 4}s ease-in-out ${Math.random() * 3}s infinite`,
              }} />
            ))}
          </Box>
        )}
        {/* Header */}
        <Box sx={{
          px: 1.5, py: 0.5, borderBottom: `1px solid ${hyperdriveMode ? '#ff00ff20' : colors.border.default}`,
          display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 36, position: 'relative', zIndex: 1,
          transition: 'border-color 0.6s ease',
        }}>
          <IconButton size="small" onClick={handleShowSessions} sx={{ color: colors.text.dim, p: 0.5 }}>
            <ArrowBackIcon sx={{ fontSize: 16 }} />
          </IconButton>
          {parentSessionId && (
            <Chip size="small"
              icon={<ArrowBackIcon sx={{ fontSize: 10 }} />}
              label="Parent"
              onClick={() => navigate(`/console/chat/${parentSessionId}`)}
              sx={{
                fontSize: '0.50rem', fontFamily: "'JetBrains Mono', monospace", height: 18,
                bgcolor: colors.accent.blue + '10',
                border: `1px solid ${colors.accent.blue}20`,
                color: colors.accent.blue,
                cursor: 'pointer',
                '&:hover': { filter: 'brightness(1.2)' },
                mr: 0.5,
              }}
            />
          )}
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

          {/* Single unified box: input + toolbar — border tinted by mode */}
          <Box sx={{
            position: 'relative',
            zIndex: 1,
            border: `1px solid ${hyperdriveMode ? '#ff00ff60' : agentMode === 'agent' ? colors.accent.orange + '60' : colors.border.default}`,
            borderRadius: '14px',
            bgcolor: colors.bg.tertiary,
            backgroundImage: hyperdriveMode ? 'linear-gradient(#ff00ff08, #ff00ff08)' : agentMode === 'agent' ? `linear-gradient(${colors.accent.orange}08, ${colors.accent.orange}08)` : 'none',
            transition: 'border-color 0.2s, background-color 0.2s',
            '&:focus-within': { borderColor: hyperdriveMode ? '#ff00ff90' : agentMode === 'agent' ? colors.accent.orange + '90' : colors.border.strong },
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
                <PermissionBanner
                  prompt={permissionPrompt}
                  pendingCount={pendingPermissionCount}
                  onRespond={() => { setPermissionPrompt(null); setPendingPermissionCount((prev) => Math.max(0, prev - 1)); }}
                  onApproveAll={() => { setPermissionPrompt(null); setPendingPermissionCount(0); }}
                />
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

              {/* Hyperdrive */}
              <Tooltip title={hyperdriveMode ? 'HYPERDRIVE ENGAGED — Full autonomous mode. All permissions bypassed.' : 'Engage Hyperdrive — full autonomous mode (no permission prompts)'} arrow>
                <Chip
                  size="small"
                  label={hyperdriveMode ? 'hyperdriving' : 'Hyperdrive'}
                  onClick={handleHyperdriveToggle}
                  sx={{
                    fontSize: '0.55rem', height: 20, cursor: 'pointer',
                    bgcolor: hyperdriveMode ? '#ff00ff12' : colors.bg.tertiary,
                    border: `1px solid ${hyperdriveMode ? '#ff00ff30' : colors.border.default}`,
                    borderRadius: '10px',
                    color: hyperdriveMode ? '#ff00ff' : colors.text.secondary,
                    position: 'relative', overflow: 'hidden',
                    ...(hyperdriveShimmer ? {
                      '&::after': {
                        content: '""',
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'linear-gradient(120deg, transparent 35%, rgba(255,0,255,0.25) 45%, rgba(255,0,255,0.35) 50%, rgba(255,0,255,0.25) 55%, transparent 65%)',
                        backgroundSize: '200% 100%',
                        animation: 'agentx-shimmer 0.8s ease-in-out',
                        borderRadius: '10px',
                        pointerEvents: 'none',
                      },
                    } : {}),
                    '&:hover': { bgcolor: hyperdriveMode ? '#ff00ff20' : colors.bg.primary },
                  }}
                />
              </Tooltip>

              {/* Agent Mode — hidden when hyperdriving */}
              {!hyperdriveMode && (
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
              )}

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
        display: 'flex', flexDirection: 'column', overflow: 'auto',
      }}>

        {/* ─── Context ─── */}
        <Box sx={{ borderBottom: `1px solid ${colors.border.default}` }}>
          <Box
            onClick={() => setContextExpanded(!contextExpanded)}
            sx={{ px: 1.5, pt: 1.5, pb: contextExpanded ? 1.5 : 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5, '&:hover': { bgcolor: colors.bg.tertiary + '40' } }}
          >
            <ArticleIcon sx={{ fontSize: 12, color: '#00bcd4' }} />
              <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
                {contextExpanded ? '▾' : '▸'} CONTEXT
              </Typography>
              {contextData && (
                <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>{contextData.length} chars</Typography>
              )}
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); handleRebuildContext(); }}
                disabled={rebuildingContext}
                sx={{ p: 0.25, color: rebuildingContext ? colors.accent.blue : colors.text.dim, '&:hover': { color: '#00bcd4' } }}
              >
                <ReplayIcon sx={{ fontSize: 12, animation: rebuildingContext ? 'agentx-spin 1s linear infinite' : 'none' }} />
              </IconButton>
          </Box>
          {contextExpanded && (
            <Box sx={{ px: 1.5, pb: 1.5 }}>
              {contextData ? (
                <Box sx={{ bgcolor: colors.bg.tertiary, borderRadius: 0.75, p: 1, maxHeight: 300, overflow: 'auto' }}>
                  <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, whiteSpace: 'pre-wrap', lineHeight: 1.5, wordBreak: 'break-word' }}>
                    {contextData}
                  </Typography>
                </Box>
              ) : (
                <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontStyle: 'italic' }}>No context yet</Typography>
              )}
            </Box>
          )}
        </Box>

        {/* ─── Token usage ─── */}
        <Box sx={{ borderBottom: `1px solid ${colors.border.default}` }}>
          <Box
            onClick={() => setTokenExpanded(!tokenExpanded)}
            sx={{ px: 1.5, pt: 1.5, pb: tokenExpanded ? 0.75 : 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5, '&:hover': { bgcolor: colors.bg.tertiary + '40' } }}
          >
            <AutoGraphIcon sx={{ fontSize: 12, color: '#4caf50' }} />
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
              {tokenExpanded ? '▾' : '▸'} TOKEN USAGE
            </Typography>
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: tokenPercent > 80 ? colors.accent.red : colors.text.secondary }}>
              {Math.round(tokenPercent)}%
            </Typography>
          </Box>
          {tokenExpanded && (
          <Box sx={{ px: 1.5, pb: 1.5 }}>
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
          )}
        </Box>

        {/* ─── Tasks ─── */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <Box
            onClick={() => setTasksExpanded(!tasksExpanded)}
            sx={{ px: 1.5, pt: 1.5, pb: tasksExpanded ? 0.75 : 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5, '&:hover': { bgcolor: colors.bg.tertiary + '40' } }}
          >
            <ChecklistIcon sx={{ fontSize: 12, color: colors.accent.blue }} />
            <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
              {tasksExpanded ? '▾' : '▸'} TASKS
            </Typography>
            {todoItems.length > 0 && (
              <Chip size="small" label={`${todoItems.filter(t => t.status === 'completed').length}/${todoItems.length}`} sx={{ fontSize: '0.45rem', height: 15 }} />
            )}
          </Box>
          {tasksExpanded && (
          <Box sx={{ px: 1.5, pb: 1.5 }}>

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
      {/* Hyperdrive Disclaimer */}
      <Dialog
        open={showDisclaimer}
        onClose={() => setShowDisclaimer(false)}
        PaperProps={{ sx: { bgcolor: '#0a0010', border: '1px solid #ff00ff60', borderRadius: 1, maxWidth: 520, width: '90%', boxShadow: '0 0 40px #ff00ff20, 0 0 80px #00ffff10' } }}
      >
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '2px', color: '#ff00ff', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#ff00ff', boxShadow: '0 0 8px #ff00ff', animation: 'agentx-pulse 1s ease-in-out infinite' }} />
          HYPERDRIVE
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: '#cccccc', fontSize: '0.7rem', lineHeight: 1.8, mb: 1.5 }}>
            You are about to engage <strong style={{ color: '#ff00ff' }}>Hyperdrive</strong> — full autonomous execution mode.
          </Typography>
          <Box sx={{ bgcolor: '#1a0020', border: '1px solid #ff00ff30', borderRadius: 1, p: 1.5, mb: 1.5 }}>
            <Typography sx={{ color: '#ff00ff', fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace", mb: 0.5, fontWeight: 600 }}>
              ⚠ WHAT THIS MEANS
            </Typography>
            <Typography sx={{ color: '#aaaaaa', fontSize: '0.6rem', lineHeight: 1.7 }}>
              • All permission prompts are <strong style={{ color: '#ff00ff' }}>bypassed</strong><br />
              • The agent can execute <strong style={{ color: '#ff00ff' }}>any tool</strong> without asking<br />
              • File writes, shell commands, deletions — <strong style={{ color: '#ff00ff' }}>no questions asked</strong><br />
              • The agent operates at <strong style={{ color: '#ff00ff' }}>maximum autonomy</strong>
            </Typography>
          </Box>
          <Typography sx={{ color: '#ff4444', fontSize: '0.6rem', fontWeight: 600, lineHeight: 1.6, mb: 1 }}>
            WARNING: Mistakes cannot be undone. Review the agent's task carefully. You are granting unrestricted access to your filesystem and shell.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setShowDisclaimer(false)} size="small" sx={{ color: '#888', textTransform: 'none', fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace" }}>
            Cancel
          </Button>
          <Button
            onClick={confirmHyperdrive}
            size="small"
            sx={{
              color: '#0a0010', bgcolor: '#ff00ff', textTransform: 'none', fontSize: '0.65rem',
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
              '&:hover': { bgcolor: '#ff40ff' },
              boxShadow: '0 0 12px #ff00ff40',
            }}
          >
            ENGAGE HYPERDRIVE
          </Button>
        </DialogActions>
      </Dialog>
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
  table({ children }: any) {
    return <StyledTableWrapper>{children}</StyledTableWrapper>;
  },
  ul({ children }: any) {
    return <StyledUl>{children}</StyledUl>;
  },
  ol({ children }: any) {
    return <StyledOl>{children}</StyledOl>;
  },
  li({ children }: any) {
    return <StyledLi>{children}</StyledLi>;
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
      pl: 0,
      fontSize: '0.75rem',
      lineHeight: 1.7,
    },
    '& li': {
      mb: 0.35,
      color: colors.text.primary,
      listStyle: 'none',
    },
    '& li:last-child': { mb: 0 },
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
  const displayColor = crewInfo ? (crewInfo.color || getWebCrewColor(crewInfo.callsign)) : colors.accent.blue;
  const [whyOpen, setWhyOpen] = useState(false);

  if (message.isModeChange) {
    const { from, to } = message.isModeChange;
    const isHyperdrive = to === 'Hyperdrive';
    const chipColor = isHyperdrive ? '#ff00ff' : to === 'Plan' ? '#2196F3' : colors.accent.orange;

    return (
      <Box sx={{
        display: 'flex', justifyContent: 'center', my: 1.5, animation: 'agentx-fadeIn 0.25s ease-out',
      }}>
        <Chip
          size="small"
          label={`${from} → ${to}`}
          sx={{
            fontSize: '0.55rem', height: 20, fontFamily: "'JetBrains Mono', monospace",
            bgcolor: `${chipColor}12`,
            border: `1px solid ${chipColor}30`,
            borderRadius: '10px',
            color: chipColor,
            cursor: 'default',
            '& .MuiChip-label': { px: 1.25 },
          }}
        />
      </Box>
    );
  }

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
        {crewInfo && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {crewInfo.icon && (
              <Typography sx={{ fontSize: '0.85rem', lineHeight: 1 }}>{crewInfo.icon}</Typography>
            )}
            <Box sx={{
              width: 8, height: 8, borderRadius: '50%',
              bgcolor: displayColor,
              boxShadow: `0 0 6px ${displayColor}80`,
              flexShrink: 0,
            }} />
          </Box>
        )}
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: displayColor, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.5px' }}>
          {crewInfo ? crewInfo.name : 'Agent-X'}
        </Typography>
        {crewInfo && (crewInfo.confidence || crewInfo.reasons) && (
          <Tooltip
            open={whyOpen}
            onOpen={() => setWhyOpen(true)}
            onClose={() => setWhyOpen(false)}
            title={
              <Box>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, mb: 0.25 }}>
                  Match: {crewInfo.confidence ?? 'N/A'}
                </Typography>
                {crewInfo.reasons?.map((r, i) => (
                  <Typography key={i} sx={{ fontSize: '0.55rem', opacity: 0.8 }}>• {r}</Typography>
                ))}
              </Box>
            }
            arrow
            placement="top"
          >
            <Typography
              onClick={() => setWhyOpen(!whyOpen)}
              sx={{
                fontSize: '0.5rem', cursor: 'pointer', color: colors.text.dim,
                fontFamily: "'JetBrains Mono', monospace", opacity: 0.5,
                '&:hover': { opacity: 1, color: displayColor },
                lineHeight: 1,
              }}
            >
              Why?
            </Typography>
          </Tooltip>
        )}
      </Box>
      {message.thinking && (<ReasoningBlock text={message.thinking} streaming={message.streaming && !message.thinkingDoneAt} durationMs={message.thinkingDoneAt && message.thinkingStartedAt ? (message.thinkingDoneAt - message.thinkingStartedAt) : undefined} />)}
      {message.todos && message.todos.length > 0 && (<InlineTodoList items={message.todos} />)}

      {/* Chronological parts: text + tools interleaved in order of appearance */}
      {message.parts && message.parts.length > 0 ? (
        message.parts.filter((p) => {
          if (p.type === 'text') return !!p.content;
          if (p.type === 'tool') return !!p.tool;
          if (p.type === 'subagent') return !!p.agent;
          return false;
        }).map((part) => {
          switch (part.type) {
            case 'text':
              return part.content ? <CrewAwareMarkdown key={part.id} content={part.content} /> : null;
            case 'tool':
              return part.tool ? <InlineToolCall key={part.id} tool={part.tool as any} /> : null;
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
          {message.toolCalls && message.toolCalls.length > 0 && (<Box sx={{ mt: 0.5 }}>{message.toolCalls.map((t: any) => <InlineToolCall key={t.id} tool={t} />)}</Box>)}
          {message.subAgents && message.subAgents.length > 0 && (<Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>{message.subAgents.map((sa) => (<SubAgentChip key={sa.id} agent={sa as any} />))}</Box>)}
        </>
      )}

      {message.streaming && !message.content && !loadingSteps && (
        <Box sx={{ display: 'flex', gap: 0.4, py: 0.5 }}>{[0, 1, 2].map(i => (<Box key={i} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />))}</Box>
      )}
      {message.streaming && !message.content && loadingSteps && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite' }} />
          <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontStyle: 'italic' }}>{loadingSteps[0]?.label ?? 'Thinking...'}</Typography>
        </Box>
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



// ─── Sub-Agent Chip ───

function SubAgentChip({ agent }: { agent: SubAgent }) {
  const [expanded, setExpanded] = useState(false);
  const hasToolCalls = agent.toolCalls && agent.toolCalls.length > 0;
  const navigate = useNavigate();

  const handleClick = (e: React.MouseEvent) => {
    if (agent.status !== 'running') {
      // Left-click navigates to child session, expand/collapse on tool call toggle
      if (hasToolCalls && (e.target as HTMLElement).closest('[data-expand-area]')) {
        setExpanded(!expanded);
      } else {
        navigate(`/console/chat/${agent.id}`);
      }
    }
  };

  return (
    <Box>
      <Chip size="small"
        icon={agent.status === 'running' ? <CircularProgress size={10} sx={{ color: 'inherit' }} /> : <AccountTreeIcon sx={{ fontSize: 11 }} />}
        label={`${agent.name}: ${agent.task.slice(0, 35)}${agent.task.length > 35 ? '…' : ''}${hasToolCalls ? ` (${agent.toolCalls!.length})` : ''}`}
        onClick={handleClick}
        sx={{
          fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", height: 20,
          bgcolor: agent.status === 'running' ? colors.accent.purple + '10' : colors.accent.green + '10',
          border: `1px solid ${agent.status === 'running' ? colors.accent.purple : colors.accent.green}20`,
          color: agent.status === 'running' ? colors.accent.purple : colors.accent.green,
          cursor: 'pointer',
          '&:hover': { filter: 'brightness(1.2)' },
        }}
      />
      {expanded && agent.toolCalls && (
        <Box data-expand-area sx={{ mt: 0.75, ml: 0.5, borderLeft: `2px solid ${colors.border.subtle}`, pl: 1.5 }}>
          {agent.toolCalls.map((tc) => (
            <InlineToolCall key={tc.id} tool={tc} />
          ))}
        </Box>
      )}
    </Box>
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

interface PermissionBannerProps {
  prompt: { requestId: string; tool: string; path: string; riskLevel: string };
  pendingCount: number;
  onRespond: () => void;
  onApproveAll: () => void;
}

function PermissionBanner({ prompt, pendingCount, onRespond, onApproveAll }: PermissionBannerProps) {
  const handleRespond = async (choice: 'allow_once' | 'allow_always' | 'deny') => {
    try {
      await fetch('/api/permission/respond', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: prompt.requestId, choice }) });
    } catch { /* ignore */ }
    onRespond();
  };

  const handleApproveAll = async (choice: 'allow_once' | 'allow_always') => {
    try {
      await fetch('/api/permission/respond-batch', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) });
    } catch { /* ignore */ }
    onApproveAll();
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
        {pendingCount > 1 && (
          <Chip
            size="small"
            label={`Approve All (${pendingCount})`}
            onClick={() => handleApproveAll('allow_once')}
            sx={{ cursor: 'pointer', height: 15, fontSize: '0.45rem', bgcolor: colors.accent.green + '20', color: colors.accent.green, '&:hover': { bgcolor: colors.accent.green + '35' } }}
          />
        )}
      </Box>
      <Typography sx={{ fontSize: '0.6rem', mb: 0.5, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
        {prompt.tool}
      </Typography>
      {prompt.path && (
        <Typography sx={{ fontSize: '0.55rem', mb: 0.75, color: colors.text.dim, wordBreak: 'break-all' }}>
          {prompt.path}
        </Typography>
      )}
      {pendingCount > 1 && (
        <Typography sx={{ fontSize: '0.5rem', mb: 0.75, color: colors.accent.orange }}>
          {pendingCount - 1} more permission request(s) pending
        </Typography>
      )}
      {isCritical && (
        <Typography sx={{ fontSize: '0.5rem', mb: 0.75, color: colors.accent.red, fontStyle: 'italic' }}>
          This operation could permanently affect your system. Review carefully before allowing.
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
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
