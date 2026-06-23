import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';

import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ArticleIcon from '@mui/icons-material/Article';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import ChecklistIcon from '@mui/icons-material/Checklist';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { CheckCircle } from './CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import BoltIcon from '@mui/icons-material/Bolt';

import ReplayIcon from '@mui/icons-material/Replay';
import RouteIcon from '@mui/icons-material/Route';
import SearchIcon from '@mui/icons-material/Search';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import HistoryIcon from '@mui/icons-material/History';
import DownloadIcon from '@mui/icons-material/Download';

import {
  ConnectionHealthDot,
  ScrollToBottomPill,
  CommandPalette,
  SessionSearchModal,
  CheckpointDrawer,
  type PaletteAction,
} from './ChatEnhancements';
import { chat, sessions, todos, tools, models, crews, providers, system, sessionSettings, agent, connectSSE, type TelemetryEvent, type ChatMessage, type TodoItem, type SessionInfo, type Crew, type AgentMode, type ModelInfo, type ConnectionState } from '../api';
import { colors } from '../theme';
import PlanApprovalModal from './PlanApprovalModal';
import ModeEscalationModal from './ModeEscalationModal';
import StepCapModal from './StepCapModal';
import ModeSuggestionModal, { DISMISS_KEY, shouldSuggestMode } from './ModeSuggestionModal';
import { ChatInputBar } from './ChatInputBar';
import { applyOperationEventToAssistant } from '../chat/operation-tool-patch';
import { ChatMessageList } from '../chat/ChatMessageList';
import { ChildSessionDrawer, type ChildSessionDrawerState } from '../chat/ChildSessionDrawer';
import { ExecutionStatusChip } from '../chat/ExecutionStatusChip';
import { stripToolNoise, sanitizeForJson, repairStreamTextGlitches } from '../chat/utils';
import { hydrateCrewDeliverables } from '../chat/restoreCrewHydration';
import { CrewMissionCard, type CrewInterMessage } from './CrewMissionCard';
import type { CrewWorkerState } from './CrewWorkerPanel';
import { SessionGridCard } from './SessionGridCard';
import { FolderPickerModal } from './FolderPickerModal';
import { ClarificationPrompt, type ClarificationData } from './ClarificationPrompt';

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
  metadata?: Record<string, unknown>;
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
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId ?? null);
  const [copiedSessionId, setCopiedSessionId] = useState(false);
  const [parentSessionId, setParentSessionId] = useState<string | null>(null);
  const [childSessionDrawer, setChildSessionDrawer] = useState<ChildSessionDrawerState | null>(null);
  const currentSessionIdRef = useRef<string | null>(sessionId ?? null);

  // Chat state
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [inputClearSignal] = useState(0);
  const [crewWorkers, setCrewWorkers] = useState<CrewWorkerState[]>([]);
  const [crewMissionActive, setCrewMissionActive] = useState(false);
  const [crewMissionId, setCrewMissionId] = useState<string | null>(null);
  const [crewInterMessages, setCrewInterMessages] = useState<CrewInterMessage[]>([]);
  const [crewMissionSessionId, setCrewMissionSessionId] = useState<string | null>(null);
  const crewMissionSessionIdRef = useRef<string | null>(null);
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
  const streamChunkPendingRef = useRef<string | null>(null);
  const isInitialLoadRef = useRef(true);

  // Loading step indicator state
  const [loadingSteps, setLoadingSteps] = useState<Array<{ id: string; label: string; status: string }> | null>(null);

  // Provider error band state — array of messages for unified warning band
  const [warnings, setWarnings] = useState<string[]>([]);

  // Clarification prompt — only shown while agent is actively waiting (streaming)
  const [clarification, setClarification] = useState<ClarificationData | null>(null);
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
      prevRealCountRef.current = 0;
      isAtBottomRef.current = true;
      setInitialScrollDone(false);
      titleGeneratedRef.current = false;
      sessions.restore(sessionId).then(async ({ messages: historyMsgs, session, scopePath }) => {
        if (session.parentId) {
          setChildSessionDrawer({
            childSessionId: sessionId,
            label: session.title ?? 'Background work',
            kind: sessionId.startsWith('crew-worker') ? 'crew_worker' : 'sub_agent',
          });
          navigate(`/console/chat/${session.parentId}`, { replace: true });
          return;
        }
        const resolvedScope = scopePath || session.scopePath;
        const visible = historyMsgs.filter((m: any) => m.role !== 'part');
        const mapped = visible.map((m: any) => {
          const modeChange = parseModeChange(m.content);
          const content = repairStreamTextGlitches(stripToolNoise(m.content || ''));
          const parts = Array.isArray(m.parts)
            ? m.parts.map((p: any) => (p.type === 'text' && p.content
              ? { ...p, content: repairStreamTextGlitches(stripToolNoise(p.content, { trim: false })) }
              : p))
            : undefined;
          return {
            ...m,
            id: m.id || crypto.randomUUID(),
            content,
            streaming: false,
            parts,
            toolCalls: m.toolCalls?.map((tc: any) => ({ ...tc, status: 'done' as const })),
            subAgents: m.subAgents?.map((sa: any) => ({ ...sa, status: 'done' as const })),
            plan: typeof m.plan === 'string' ? JSON.parse(m.plan) : (m.plan || undefined),
            ...(modeChange ? { isModeChange: modeChange } : {}),
          };
        }) as unknown as UIMessage[];
        const hydrated = await hydrateCrewDeliverables(sessionId, mapped, crewList);
        setMessages(hydrated.messages);
        if (hydrated.crewWorkers.length > 0) {
          setCrewWorkers(hydrated.crewWorkers);
          setCrewMissionSessionId(sessionId);
          crewMissionSessionIdRef.current = sessionId;
        }
        setCurrentSessionTitle(session.title ?? `Session ${sessionId.slice(0, 8)}`);
        if (!session.title || session.title === 'New Session' || session.title === 'Child Session') {
          generateTitle(sessionId, visible);
        }
        setParentSessionId(session.parentId ?? null);
        const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        const persistedUsed = (session as any).tokenUsed ?? session.tokensUsed ?? 0;
        const tokenAvail = Number((session as any).tokenAvailable ?? (session as any).token_available ?? 0);
        if (tokenAvail > 0) setTokenTotal(tokenAvail);
        setTokenUsed(persistedUsed > 0 ? persistedUsed : inputEst + outputEst);
        setCompactionCount((session as any).compactionCount ?? 0);
        setTokenInput(inputEst);
        setTokenOutput(outputEst);
        tokenInputRef.current = inputEst;
        tokenOutputRef.current = outputEst;
        if (resolvedScope) setCwd(resolvedScope);
        // Restore saved session mode from DB (do not re-send to server)
        if (session.mode === 'plan' || session.mode === 'agent') {
          setAgentMode(session.mode);
        }
        loadTodos();
        isInitialLoadRef.current = false;
      }).catch((err) => {
        console.error('Failed to restore session on mount:', err);
        setWarnings([`Failed to restore session: ${err instanceof Error ? err.message : 'Unknown error'}`]);
        isInitialLoadRef.current = false;
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
  const [tokenReserved, setTokenReserved] = useState(0);
  const [tokenStreaming, setTokenStreaming] = useState(0);
  const [tokenInputPrice, setTokenInputPrice] = useState(0);
  const [tokenOutputPrice, setTokenOutputPrice] = useState(0);
  const [tokenTotal, setTokenTotal] = useState(128000);
  const [compactionCount, setCompactionCount] = useState(0);
  const tokenInputRef = useRef(0);
  const tokenOutputRef = useRef(0);
  const tokenReservedRef = useRef(0);

  // Collapsible sidebar sections
  const [contextExpanded, setContextExpanded] = useState(false);
  const [tokenExpanded, setTokenExpanded] = useState(true);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [contextData, setContextData] = useState('');
  const [rebuildingContext, setRebuildingContext] = useState(false);

  const applyContextPayload = useCallback((d: { context?: string; compaction?: string }) => {
    const parts: string[] = [];
    if (d.compaction?.trim()) parts.push(`[Compaction summaries]\n${d.compaction.trim()}`);
    if (d.context?.trim()) parts.push(`[Conversation]\n${d.context.trim()}`);
    setContextData(parts.length > 0 ? parts.join('\n\n') : '');
  }, []);

  const refreshContext = useCallback(() => {
    if (!currentSessionId) return;
    fetch(`/api/sessions/${currentSessionId}/context`, { credentials: 'include' })
      .then(r => r.json())
      .then(applyContextPayload)
      .catch(() => {});
  }, [currentSessionId, applyContextPayload]);

  const refreshContextRef = useRef(refreshContext);
  useEffect(() => { refreshContextRef.current = refreshContext; }, [refreshContext]);

  const handleRebuildContext = useCallback(async () => {
    if (!currentSessionId || rebuildingContext) return;
    setRebuildingContext(true);
    try {
      const r = await fetch(`/api/sessions/${currentSessionId}/context/rebuild`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (d.ok) refreshContext();
    } catch { /* ignore */ }
    setRebuildingContext(false);
  }, [currentSessionId, rebuildingContext, refreshContext]);

  // Model/Provider state
  const [currentModel, setCurrentModel] = useState('');
  const [currentProvider, setCurrentProvider] = useState('');
  const [currentProviderId, setCurrentProviderId] = useState('');
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
  const hyperdrivePromptShownRef = useRef(false);   // show disclaimer once per session
  const lastShiftRef = useRef(0);                    // double-Shift detection
  const prevModeBeforeHyperdrive = useRef<AgentMode>('agent'); // restore on exit

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
  const cwdRef = useRef('');

  // Dropdown anchors
  const [modeMenuAnchor, setModeMenuAnchor] = useState<null | HTMLElement>(null);
  const [providerMenuAnchor, setProviderMenuAnchor] = useState<null | HTMLElement>(null);
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);

  // Send action menu moved to ChatInputBar

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

  // Agent gate modals (plan approval, mode escalation, step cap)
  const [planApproval, setPlanApproval] = useState<{ title: string; steps: { id: string; description: string }[] } | null>(null);
  const [modeEscalation, setModeEscalation] = useState<{ tool: string; reason: string } | null>(null);
  const [stepCapPrompt, setStepCapPrompt] = useState<{ currentSteps: number; maxSteps: number } | null>(null);
  const [turnActivity, setTurnActivity] = useState<{ stage: string; step: number; elapsedMs: number } | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const resendInProgressRef = useRef(false);
  const lastActivityRef = useRef<number>(Date.now());
  const isTimeoutWarning = (msg: string) => /timeout|timed out|aborted due to timeout/i.test(msg);
  const clearTimeoutWarnings = useCallback((prev: string[]) => prev.filter(w => !isTimeoutWarning(w)), []);
  const isAgentRecentlyActive = useCallback((withinMs = 45000) => Date.now() - lastActivityRef.current < withinMs, []);
  const [modeSuggestOpen, setModeSuggestOpen] = useState(false);
  const pendingSendTextRef = useRef<string | null>(null);

  // Smart auto-scroll state
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);
  const jumpSuppressScrollTopRef = useRef<number | null>(null);
  const [showJumpPill, setShowJumpPill] = useState(false);

  // RAF-batched tool event accumulator (prevents render storm on long-running tasks)
  const toolBatchRef = useRef<TelemetryEvent[]>([]);
  const toolFlushRef = useRef<number | null>(null);

  // ─── Smart auto-scroll: track user scroll position ───
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom < 80;
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        jumpSuppressScrollTopRef.current = null;
        setShowJumpPill(false);
        return;
      }
      if (jumpSuppressScrollTopRef.current !== null) {
        const scrolledUpEnough = el.scrollTop < jumpSuppressScrollTopRef.current - 100;
        if (!scrolledUpEnough) {
          setShowJumpPill(false);
          return;
        }
        jumpSuppressScrollTopRef.current = null;
      }
      if (distanceFromBottom > 120) {
        setShowJumpPill(true);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [view]);

  // Auto-scroll to bottom on session load/restore
  const [initialScrollDone, setInitialScrollDone] = useState(false);
  useEffect(() => {
    if (!initialScrollDone && messages.length > 0) {
      const timer = setTimeout(() => {
        bottomRef.current?.scrollIntoView();
        setInitialScrollDone(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [messages.length, initialScrollDone]);

  // Auto-scroll only when user is at bottom — also on streaming content updates
  const prevRealCountRef = useRef(0);
  useEffect(() => {
    const realMsgs = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    const countChanged = realMsgs.length > prevRealCountRef.current;
    if (countChanged) prevRealCountRef.current = realMsgs.length;
    if (!countChanged && !streaming) return;
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: countChanged ? 'smooth' : 'instant' });
    } else if (countChanged) {
      setShowJumpPill(true);
    }
  }, [messages, streaming]);

  // Load sessions
  const loadSessions = useCallback(() => {
    sessions.list().then((list) => setSessionList(list.filter((s) => !s.parentId))).catch(() => {});
  }, []);

  const openChildSession = useCallback((props: {
    childSessionId: string;
    label: string;
    kind: 'sub_agent' | 'crew_worker';
  }) => {
    setChildSessionDrawer({
      childSessionId: props.childSessionId,
      label: props.label,
      kind: props.kind,
    });
  }, []);

  const titleGeneratedRef = useRef(false);
  const generateTitle = async (sid: string, msgs: any[]) => {
    if (titleGeneratedRef.current) return;
    const firstUser = msgs.find((m: any) => m.role === 'user');
    if (!firstUser) return;
    titleGeneratedRef.current = true;
    try {
      const { title } = await sessions.generateTitle(sid);
      if (title) {
        setCurrentSessionTitle(title);
        loadSessions();
      }
    } catch { /* best-effort */ }
  };

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
      .then((r) => { setCurrentModel(r.model || ''); setCurrentProvider(r.activeProfile || r.provider || ''); setCurrentProviderId(r.providerId || r.provider || ''); })
      .catch(() => {
        // Fallback: get active provider from /providers endpoint
        fetch('/api/providers', { credentials: 'include' })
          .then(r => r.json())
          .then((data: { active?: string }) => { if (data.active) { setCurrentProvider(data.active); setCurrentProviderId(data.active); } })
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
    if (match?.contextWindow) {
      setTokenTotal(match.contextWindow);
      const reserve = Math.min(20000, Math.round(match.contextWindow * 0.15));
      setTokenReserved(reserve);
      tokenReservedRef.current = reserve;
    }
  }, [currentModel, modelList]);

  // Helper to immutably update the last assistant message (avoids React mutation anti-pattern).
  const updateLastMessage = (msgs: UIMessage[], updates: Partial<UIMessage>): UIMessage[] => {
    if (msgs.length === 0) return msgs;
    const last = msgs[msgs.length - 1];
    if (last?.role !== 'assistant') return msgs;
    return [...msgs.slice(0, -1), { ...last, ...updates }];
  };

  const attachChildSessionToAssistant = (
    prev: UIMessage[],
    childSessionId: string,
    label: string,
    kind: 'sub_agent' | 'crew_worker',
    task = '',
  ): UIMessage[] => {
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
    const subAgents = hasMatch
      ? upgraded
      : [...existing, { id: childSessionId, name: label, task, status: 'running' as const, kind }];
    const parts = (last.parts ?? []).map((p) =>
      p.type === 'subagent' && (p.agent?.id === 'subagent' || p.agent?.id === childSessionId)
        ? { ...p, id: childSessionId, agent: { ...p.agent!, id: childSessionId, name: label, kind, task: task || p.agent!.task, status: 'running' as const } }
        : p,
    );
    const hasPart = parts.some((p) => p.type === 'subagent' && p.agent?.id === childSessionId);
    const nextParts = hasPart
      ? parts
      : [...(last.parts ?? []), { type: 'subagent' as const, id: childSessionId, agent: { id: childSessionId, name: label, task, status: 'running' as const, kind } }];
    return updateLastMessage(prev, { subAgents, parts: nextParts });
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
            if ((last.subAgents ?? []).some((a) => a.id === callId)) return prev;
            const sa: SubAgent = { id: callId, name: 'Sub-Agent', task: desc, status: 'running' };
            const saPart: PartEntry = { type: 'subagent', id: callId, agent: sa };
            return updateLastMessage(prev, {
              subAgents: [...(last.subAgents ?? []), sa],
              parts: [...(last.parts || []), saPart],
            });
          }
          const existingParts = last.parts || [];
          if (existingParts.some((p) => p.type === 'tool' && p.tool?.id === callId)) return prev;
          if (!last.streaming && existingParts.some((p) => p.type === 'tool' && p.tool?.name === toolName && p.tool.status === 'done')) {
            return prev;
          }
          const tc: ToolCall = { id: callId, name: toolName, args: eventArgs, status: 'running' };
          const toolPart: PartEntry = { type: 'tool', id: callId, tool: tc };
          return updateLastMessage(prev, { toolCalls: [...(last.toolCalls ?? []), tc], parts: [...existingParts, toolPart] });
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
          const meta = (ev as any).metadata as Record<string, unknown> | undefined;
          if (resObj?.error === 'TOOL_NOT_FOUND' || resObj?.error === 'NO_HANDLER') setToolEnablePrompt({ toolId: toolName, toolName });
          const withMeta = (t: ToolCall) => (meta ? { ...t, metadata: { ...t.metadata, ...meta } } : t);
          return updateLastMessage(prev, {
            toolCalls: newToolCalls.map(withMeta),
            parts: newParts.map((p) => (p.type === 'tool' && p.tool ? { ...p, tool: withMeta(p.tool) } : p)),
          });
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
        // Ignore stale tool events replayed from telemetry buffer on page load
        if (isInitialLoadRef.current) return;
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
            // Ignore stale loading_start events replayed from telemetry buffer on page load
            if (isInitialLoadRef.current) { return prev; }
            streamChunkPendingRef.current = null;
            if (streamChunkRAFRef.current !== null) {
              cancelAnimationFrame(streamChunkRAFRef.current);
              streamChunkRAFRef.current = null;
            }
            setLoadingSteps(null);
            const loadingStage = (ev as { stage?: string }).stage;
            // Crew missions stream crew-attributed messages — no Agent-X placeholder bubble
            if (loadingStage === 'crew_mission') {
              setStreaming(true);
              return prev;
            }
            // Only create a placeholder when a user message just arrived (new turn).
            // If the last message is a completed assistant (race with handleSend),
            // let stream_chunk or message_received handle the placeholder instead.
            if (last?.role === 'user') {
              setStreaming(true);
              return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }];
            }
            if (last?.role === 'assistant' && (last.streaming || resendInProgressRef.current)) {
              setStreaming(true);
              return prev;
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
            // Ignore stale stream chunks replayed from telemetry buffer on page load
            if (isInitialLoadRef.current) return prev;
            const rawDelta = (ev.content as string) ?? '';
            if (/Calling:|✅ Result:|\[STEP \d+\]/.test(rawDelta)) return prev;
            const rawFull = (ev.fullContent as string) ?? '';
            if (!rawFull && !rawDelta) return prev;
            if (last?.role === 'assistant') {
              streamChunkPendingRef.current = rawFull || null;
              if (streamChunkRAFRef.current === null) {
                streamChunkRAFRef.current = requestAnimationFrame(() => {
                  streamChunkRAFRef.current = null;
                  const fullContent = streamChunkPendingRef.current ?? '';
                  streamChunkPendingRef.current = null;
                  if (!fullContent) return;
                  setMessages(p => {
                    const l = p[p.length - 1];
                    if (l?.role !== 'assistant') return p;
                    const parts = l.parts || [];
                    const lastPart = parts[parts.length - 1];
                    const prefixEnd = lastPart?.type === 'text' ? parts.length - 1 : parts.length;
                    let prefixLen = 0;
                    for (let i = 0; i < prefixEnd; i++) {
                      const part = parts[i];
                      if (part?.type === 'text' && part.content) prefixLen += part.content.length;
                    }
                    const segmentText = fullContent.slice(prefixLen);
                    if (lastPart?.type === 'text') {
                      const updatedParts = [...parts.slice(0, -1), { ...lastPart, content: segmentText }];
                      return updateLastMessage(p, { content: fullContent, parts: updatedParts, streaming: true });
                    }
                    const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: segmentText };
                    return updateLastMessage(p, { content: fullContent, parts: [...parts, textPart], streaming: true });
                  });
                  const streamingEst = Math.ceil(fullContent.length / 4);
                  setTokenStreaming(streamingEst);
                  setTokenUsed(tokenInputRef.current + tokenOutputRef.current + streamingEst + tokenReservedRef.current);
                });
              }
              return prev;
            }
            setStreaming(true);
            const textPart: PartEntry = { type: 'text', id: crypto.randomUUID(), content: rawFull || rawDelta };
            return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: rawFull || rawDelta, streaming: true, parts: [textPart] }];
          }

          case 'loading_end':
            setLoadingSteps(null);
            setCrewWorkers((cw) => {
              if (cw.length > 0 && cw.every((x) => x.status === 'done' || x.status === 'error')) {
                setCrewMissionActive(false);
              }
              return cw;
            });
            // Keep streaming true until message_received — background work may still be running
            return prev;

          case 'message_received': {
            // Ignore stale message_received events replayed from telemetry buffer on page load
            if (isInitialLoadRef.current) return prev;
            setTurnActivity(null);
            activeTurnIdRef.current = null;
            resendInProgressRef.current = false;
            setClarification(null);
            setTokenStreaming(0);
            const msg = ev.message as { id?: string; content?: string; role?: string; parts?: PartEntry[]; toolCalls?: ToolCall[]; crew?: { crewId: string; name: string; callsign: string; color?: string; icon?: string; confidence?: string; reasons?: string[] }; tokenCount?: number } | undefined;
            const crew = msg?.crew;
            setStreaming(false);
            if (!msg || msg.role === 'system') return prev;
            const text = repairStreamTextGlitches(stripToolNoise(msg.content ?? ''));
            if (last?.role === 'assistant') {
              const incomingCrewId = crew?.crewId;
              const lastCrewId = last.crew?.crewId;
              const sameSpeaker = incomingCrewId
                ? incomingCrewId === lastCrewId
                : !lastCrewId;
              const shouldMerge = sameSpeaker && (last.streaming || (!text && !!last.content));
              if (shouldMerge) {
                const mergedParts = (last.parts && last.parts.length > 0) ? last.parts : msg.parts;
                return updateLastMessage(prev, {
                  id: msg.id || last.id,
                  content: text || stripToolNoise(last.content || ''),
                  parts: mergedParts,
                  toolCalls: last.toolCalls?.length ? last.toolCalls : msg.toolCalls,
                  streaming: false,
                  ...(crew ? { crew } : {}),
                });
              }
            }
            if (msg.role === 'assistant' && (text || msg.parts?.length)) {
              const msgId = msg.id || crypto.randomUUID();
              if (prev.some((m) => m.id === msgId)) return prev;
              const parts = msg.parts || [{ type: 'text' as const, id: crypto.randomUUID(), content: text }];
              return [...prev, { id: msgId, role: 'assistant' as const, content: text, streaming: false, parts, ...(crew ? { crew } : {}) } as UIMessage];
            }
            return prev;
          }

          case 'permission_required':
            // Ignore stale permission prompts replayed from telemetry buffer on page load
            if (isInitialLoadRef.current) { return prev; }
            setPendingPermissionCount((prev) => prev + 1);
            setPermissionPrompt({
              requestId: (ev.requestId as string) ?? `${ev.tool}-${Date.now()}`,
              tool: (ev.tool as string) ?? 'unknown',
              path: (ev.path as string) ?? '',
              riskLevel: (ev.riskLevel as string) ?? 'medium',
            });
            return prev;

          case 'token_usage': {
            const cw = ev.contextWindow as number | undefined;
            if (cw != null && cw > 0) setTokenTotal(cw);
            const inp = ev.inputTokens as number | undefined;
            const out = ev.outputTokens as number | undefined;
            const reserved = ev.reservedTokens as number | undefined;
            const streaming = ev.streamingTokens as number | undefined;
            if (inp != null) {
              setTokenInput(inp);
              tokenInputRef.current = inp;
            }
            if (out != null) {
              setTokenOutput(out);
              tokenOutputRef.current = out;
            }
            if (reserved != null) {
              setTokenReserved(reserved);
              tokenReservedRef.current = reserved;
            }
            if (streaming != null) setTokenStreaming(streaming);
            const used = ev.totalTokens as number | undefined;
            if (used != null) setTokenUsed(used);
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

          case 'command_action': {
            const action = ev.action as string | undefined;
            if (action === 'model_switched') {
              const cw = ev.contextWindow as number | undefined;
              if (cw != null && cw > 0) setTokenTotal(cw);
            }
            return prev;
          }

          case 'compaction_complete':
            setCompactionCount(c => c + 1);
            refreshContextRef.current();
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
            setStreaming(true);
            setClarification({
              question: (ev.question as string) ?? 'Could you clarify?',
              options: (ev.options as string[]) ?? [],
              recommended: (ev.recommended as string) ?? undefined,
              allowChooseAll: (ev.allowChooseAll as boolean) ?? false,
              allowFreeform: (ev.allowFreeform as boolean) ?? true,
              selectionMode: (ev as { selectionMode?: 'single' | 'multiple' }).selectionMode,
              fields: (ev as { fields?: ClarificationData['fields'] }).fields,
            });
            return prev;
          }

          case 'error': {
            // Suppress cascaded errors after a rate-limit — only show the first warning
            if (rateLimitSeenRef.current) {
              setStreaming(false);
              return prev;
            }
            const errorText = (ev.message as string) ?? (ev.error as string) ?? 'Unknown error';
            // Ignore stale timeout errors while the agent is still actively working
            if (isTimeoutWarning(errorText) && isAgentRecentlyActive()) {
              return prev;
            }
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

          case 'plan_mode_violation': {
            const rolledBack = (ev as { rolledBack?: boolean }).rolledBack;
            const count = ((ev as { violations?: unknown[] }).violations ?? []).length;
            setWarnings(prev => replaceWarning(prev, rolledBack
              ? `Plan mode violation: ${count} write operation(s) detected — session rolled back to checkpoint.`
              : `Plan mode violation: ${count} write operation(s) detected.`));
            return prev;
          }

          case 'mode_restricted':
            // Do not auto-switch — ModeEscalationModal handles user choice
            return prev;

          case 'plan_approval_required': {
            const plan = (ev as { plan?: { title?: string; steps?: { id: string; description: string }[] } }).plan;
            if (plan?.steps) {
              setPlanApproval({ title: plan.title ?? 'Plan', steps: plan.steps });
            }
            return prev;
          }

          case 'mode_escalation_required': {
            const tool = (ev as { tool?: string }).tool ?? 'tool';
            const reason = (ev as { reason?: string }).reason ?? 'Plan mode blocks this operation.';
            setModeEscalation({ tool, reason });
            return prev;
          }

          case 'mode_escalation_accepted':
            setAgentMode('agent');
            sessionSettings.setMode('agent').catch(() => {});
            setModeEscalation(null);
            return [...prev, {
              id: crypto.randomUUID(), role: 'system' as const, content: '',
              timestamp: new Date().toISOString(),
              isModeChange: { from: 'Plan', to: 'Agent' },
            }];

          case 'mode_escalation_declined':
            setModeEscalation(null);
            setStreaming(false);
            return prev;

          case 'step_cap_reached': {
            const currentSteps = (ev as { currentSteps?: number }).currentSteps ?? 25;
            const maxSteps = (ev as { maxSteps?: number }).maxSteps ?? 25;
            setStepCapPrompt({ currentSteps, maxSteps });
            return prev;
          }

          case 'turn_heartbeat': {
            setTurnActivity({
              stage: (ev as { stage?: string }).stage ?? 'working',
              step: (ev as { step?: number }).step ?? 0,
              elapsedMs: (ev as { elapsedMs?: number }).elapsedMs ?? 0,
            });
            setWarnings(clearTimeoutWarnings);
            return prev;
          }

          case 'operation_file_edited':
          case 'operation_file_created':
          case 'operation_file_read':
          case 'operation_search_glob':
          case 'operation_search_grep':
          case 'operation_list_files':
          case 'operation_command_executed':
            return applyOperationEventToAssistant(prev, ev as Record<string, unknown> & { type: string });

          case 'agent_thinking':
          case 'step_indicator':
            return prev;

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

          case 'crew_mission_start': {
            const sid = currentSessionIdRef.current;
            if (!sid) return prev;
            crewMissionSessionIdRef.current = sid;
            setCrewMissionSessionId(sid);
            setCrewMissionActive(true);
            setCrewWorkers([]);
            setCrewInterMessages([]);
            setCrewMissionId((ev as unknown as { missionId?: string }).missionId ?? null);
            return prev;
          }

          case 'crew_mission_complete':
            if (!isCrewEventForCurrentSession()) return prev;
            setCrewMissionActive(false);
            setCrewWorkers((cw) => cw.map((x) =>
              (x.status === 'running' || x.status === 'verifying' || x.status === 'retrying')
                ? { ...x, status: 'done' as const, message: 'Complete' }
                : x,
            ));
            return prev;

          case 'crew_inter_message': {
            if (!isCrewEventForCurrentSession()) return prev;
            const m = ev as unknown as { from: string; to: string; content: string };
            setCrewInterMessages((msgs) => [...msgs, {
              id: crypto.randomUUID(),
              from: m.from,
              to: m.to,
              content: m.content,
              timestamp: new Date().toISOString(),
            }]);
            return prev;
          }

          case 'crew_mission_retry':
            if (!isCrewEventForCurrentSession()) return prev;
            setCrewWorkers((cw) => cw.map((x) => ({ ...x, status: 'retrying' as const, message: 'Retrying…' })));
            return prev;

          case 'crew_worker_spawned': {
            if (!isCrewEventForCurrentSession()) return prev;
            const w = ev as unknown as { workerId: string; crewId: string; crewName: string; callsign: string };
            const color = crewList.find((c) => c.id === w.crewId)?.color;
            setCrewWorkers((cw) => [...cw.filter((x) => x.workerId !== w.workerId), {
              workerId: w.workerId,
              crewId: w.crewId,
              crewName: w.crewName,
              callsign: w.callsign,
              color,
              status: 'running',
              message: 'Starting…',
            }]);
            return prev;
          }

          case 'crew_worker_progress': {
            if (!isCrewEventForCurrentSession()) return prev;
            const w = ev as unknown as { workerId: string; status: CrewWorkerState['status']; message?: string };
            setCrewWorkers((cw) => cw.map((x) =>
              x.workerId === w.workerId ? { ...x, status: w.status, message: w.message ?? x.message } : x,
            ));
            return prev;
          }

          case 'crew_worker_complete': {
            if (!isCrewEventForCurrentSession()) return prev;
            const w = ev as unknown as { workerId: string; success: boolean; elapsed: number; output?: string };
            setCrewWorkers((cw) => {
              const updated = cw.map((x) =>
                x.workerId === w.workerId
                  ? {
                    ...x,
                    status: w.success ? 'done' as const : 'error' as const,
                    elapsed: w.elapsed,
                    message: w.success ? 'Complete' : 'Failed',
                  }
                  : x,
              );
              if (updated.length > 0 && updated.every((x) => x.status === 'done' || x.status === 'error')) {
                setCrewMissionActive(false);
              }
              return updated;
            });
            return prev;
          }

          case 'child_session_started': {
            const c = ev as unknown as { childSessionId: string; label: string; kind: 'sub_agent' | 'crew_worker' };
            if (!c.childSessionId) return prev;
            return attachChildSessionToAssistant(prev, c.childSessionId, c.label || 'Background work', c.kind ?? 'sub_agent');
          }

          case 'agent_spawned': {
            const agentId = ev.agentId as string;
            const task = (ev.task as string) ?? '';
            if (!agentId) return prev;
            return attachChildSessionToAssistant(prev, agentId, 'Sub-Agent', 'sub_agent', task.slice(0, 200));
          }

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
      isInitialLoadRef.current = false;
    }).catch(() => {
      isInitialLoadRef.current = false;
    });
  }, [sessionId]);

  // Streaming timeout — tracks activity via SSE events.
  // - All SSE events (tool, chunk, status) reset the activity timer.
  // - After 2 minutes of inactivity, tries to recover the response from the API.
  // - Retries recovery every tick until streaming ends or a complete response is found.
  // - Never force-closes streaming — the agent may be processing tools for minutes.
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

  // Poll async turn status when SSE may miss completion/error
  useEffect(() => {
    const turnId = activeTurnIdRef.current;
    if (!turnId || !streaming) return;
    const poll = setInterval(() => {
      chat.getTurn(turnId).then((record) => {
        if (record.status === 'error') {
          const err = record.error ?? 'Turn failed';
          // Turn registry may mark timeout while SSE still shows live activity
          if (isTimeoutWarning(err) && isAgentRecentlyActive()) return;
          setWarnings(prev => replaceWarning(prev, err));
          if (record.partialContent) {
            setMessages(p => {
              const last = p[p.length - 1];
              if (last?.role === 'assistant') {
                return updateLastMessage(p, { content: record.partialContent!, streaming: false });
              }
              return p;
            });
          }
          setStreaming(false);
          activeTurnIdRef.current = null;
        } else if (record.status === 'complete' || record.status === 'cancelled') {
          activeTurnIdRef.current = null;
        }
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(poll);
  }, [streaming]);

  // Compute whether send is blocked due to missing provider/model
  const sendBlocked = !currentProvider || !currentModel;
  const sendBlockedReason = !currentProvider ? 'Select a provider before sending' : !currentModel ? 'Select a model before sending' : '';

  // Keep refs in sync so send handlers never capture stale session/cwd from closures.
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => { cwdRef.current = cwd; }, [cwd]);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (currentSessionIdRef.current) return currentSessionIdRef.current;
    const scopePath = cwdRef.current;
    if (!scopePath) {
      pendingFolderActionRef.current = 'newSession';
      setFolderConsentOpen(true);
      return null;
    }
    try {
      const result = await sessions.create(scopePath);
      const newId = result?.sessionId;
      if (newId) {
        setCurrentSessionId(newId);
        currentSessionIdRef.current = newId;
        skipRestoreRef.current = true;
        navigate(`/console/chat/${newId}`);
        return newId;
      }
      setWarnings(['Failed to create session. Please try again.']);
    } catch (e) {
      setWarnings([`Failed to create session: ${e instanceof Error ? e.message : 'Unknown error'}`]);
    }
    return null;
  }, [navigate]);

  const executeSend = useCallback(async (text: string) => {
    const trimmed = sanitizeForJson(text.trim());
    if ((!trimmed && attachments.length === 0)) return;
    if (!currentProvider || !currentModel) return;
    rateLimitSeenRef.current = false;
    if (!(await ensureSession())) return;

    setStreaming(true);
    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      streaming: false,
      attachments: attachments.map((a) => ({ name: a.name })),
    };
    setMessages((prev) => [...prev, userMsg]);

    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);

    try {
      const result = await chat.send(trimmed, fileRefs);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      if (result?.message) {
        const msg = result.message;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            const fullContent = msg.content || '';
            if (fullContent) return [...prev.slice(0, -1), { ...last, ...msg, streaming: false } as UIMessage];
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
      setStreaming(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const displayError = errorMsg.length > 200 ? errorMsg.slice(0, 200) + '...' : errorMsg;
      const isProviderErr = /429|quota|billing|suspended|rate.?limit|api.?key|unauthorized|forbidden|exceeded|invalid.*key|disabled|expired|insufficient|credits|balance|dunning|deny/i.test(errorMsg);
      if (isProviderErr) {
        setWarnings(prev => replaceWarning(prev, extractProviderError(errorMsg)));
        chat.cancel().catch(() => {});
      } else {
        setWarnings(prev => replaceWarning(prev, displayError));
        chat.cancel().catch(() => {});
      }
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.streaming) return prev.slice(0, -1);
        return prev;
      });
      setStreaming(false);
    }
  }, [attachments, currentProvider, currentModel, agentMode, ensureSession]);

  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0)) return;
    if (agentMode === 'plan' && shouldSuggestMode(trimmed) && !localStorage.getItem(DISMISS_KEY)) {
      pendingSendTextRef.current = trimmed;
      setModeSuggestOpen(true);
      return;
    }
    await executeSend(trimmed);
  }, [attachments.length, agentMode, executeSend]);

  // Retry last user message — re-sends without duplicating the user message,
  // replaces the existing assistant response on success.
  const handleResend = useCallback(async (text: string) => {
    if (!text || streaming || !currentProvider || !currentModel) return;
    if (!(await ensureSession())) return;

    resendInProgressRef.current = true;
    setStreaming(true);

    // Remove the old assistant response — SSE will update the placeholder
    setMessages(prev => {
      const last = prev[prev.length - 1];
      return last?.role === 'assistant' ? prev.slice(0, -1) : prev;
    });

    try {
      const result = await chat.send(sanitizeForJson(text), undefined, true);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
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
  }, [streaming, currentProvider, currentModel, ensureSession]);

  // --- Clarification response ---
  const handleClarifyRespond = useCallback(async (response: string) => {
    setClarification(null);
    try {
      await agent.respondToClarification(response);
      setStreaming(true);
    } catch {
      setWarnings((prev) => replaceWarning(prev, 'Failed to send clarification response'));
    }
  }, []);

  const resetCrewMissionState = useCallback(() => {
    setCrewWorkers([]);
    setCrewMissionActive(false);
    setCrewMissionId(null);
    setCrewInterMessages([]);
    setCrewMissionSessionId(null);
    crewMissionSessionIdRef.current = null;
  }, []);

  const isCrewEventForCurrentSession = useCallback(() => {
    const bound = crewMissionSessionIdRef.current;
    const current = currentSessionIdRef.current;
    return bound != null && current != null && bound === current;
  }, []);

  useEffect(() => { setClarification(null); }, [currentSessionId]);
  useEffect(() => { resetCrewMissionState(); }, [currentSessionId, resetCrewMissionState]);
  useEffect(() => { if (!streaming) setClarification(null); }, [streaming]);

  const handleCancel = useCallback(async () => {
    try { await chat.cancel(); } catch { /* ignore */ }
    setClarification(null);
    setStreaming(false);
  }, []);

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
  const engageHyperdrive = useCallback(async (skipDisclaimer = false) => {
    if (hyperdriveMode) {
      // Deactivate hyperdrive — restore previous mode
      try {
        const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json();
        setHyperdriveMode(false);
        if (data.mode) setAgentMode(data.mode);
        else setAgentMode(prevModeBeforeHyperdrive.current);
      } catch {}
      return;
    }
    // Activate hyperdrive
    if (!skipDisclaimer && !hyperdrivePromptShownRef.current) {
      setShowDisclaimer(true);
      return;
    }
    // Skip disclaimer — directly engage
    hyperdrivePromptShownRef.current = true;
    try {
      const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      prevModeBeforeHyperdrive.current = agentMode;
      setHyperdriveMode(true);
      if (data.mode) setAgentMode(data.mode);
    } catch {}
  }, [hyperdriveMode, agentMode]);

  const handleHyperdriveToggle = useCallback(() => {
    engageHyperdrive();
  }, [engageHyperdrive]);

  const confirmHyperdrive = useCallback(async () => {
    setShowDisclaimer(false);
    hyperdrivePromptShownRef.current = true;
    try {
      const res = await fetch('/api/mode/hyperdrive', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      prevModeBeforeHyperdrive.current = agentMode;
      setHyperdriveMode(true);
      if (data.mode) setAgentMode(data.mode);
    } catch {}
  }, [agentMode]);

  // Check hyperdrive mode on mount
  useEffect(() => {
    hyperdrivePromptShownRef.current = false; // reset on session change
    fetch('/api/mode/hyperdrive', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.hyperdriveMode) {
          setHyperdriveMode(true);
          if (d.mode) setAgentMode(d.mode);
        }
      })
      .catch(() => {});
  }, [currentSessionId]);

  // Refresh context data when session loads or changes
  useEffect(() => {
    if (!currentSessionId) return;
    refreshContext();
    const interval = setInterval(refreshContext, 15000);
    return () => clearInterval(interval);
  }, [currentSessionId, refreshContext]);

  // Double-Esc ref for cancel
  const lastEscRef = useRef(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Tab') {
        // Hyperdrive active → TAB deactivates it, restores previous mode
        if (hyperdriveMode) {
          e.preventDefault();
          engageHyperdrive(); // toggles off (hyperdriveMode is true → deactivates)
          return;
        }
        e.preventDefault();
        handleToggleMode();
      } else if (e.key === 'Shift') {
        // Double-Shift → engage/disengage hyperdrive
        const now = Date.now();
        if (now - lastShiftRef.current < 500) {
          lastShiftRef.current = 0;
          engageHyperdrive(); // toggles: off→on (with/without disclaimer), on→off
        } else {
          lastShiftRef.current = now;
        }
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
  }, [currentSessionId, streaming, messages, handleResend, view, handleToggleMode, hyperdriveMode, engageHyperdrive]);

  // ─── Command palette actions ───
  const paletteActions: PaletteAction[] = useMemo(() => [
    { id: 'new-session', label: 'New session', hint: 'N', icon: <AddIcon sx={{ fontSize: 14 }} />, run: () => handleNewSession() },
    { id: 'sessions', label: 'Show all sessions', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => handleShowSessions() },
    { id: 'search', label: 'Search sessions', hint: '⌘F', icon: <SearchIcon sx={{ fontSize: 14 }} />, run: () => setSearchOpen(true) },
    { id: 'checkpoints', label: 'Open checkpoints', icon: <HistoryIcon sx={{ fontSize: 14 }} />, run: () => setCheckpointsOpen(true) },
    { id: 'mode-agent', label: 'Switch mode → Agent', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => { setAgentMode('agent'); sessionSettings.setMode('agent').catch(() => {}); } },
    { id: 'mode-plan', label: 'Switch mode → Plan', icon: <RouteIcon sx={{ fontSize: 14 }} />, run: () => { setAgentMode('plan'); sessionSettings.setMode('plan').catch(() => {}); } },
  ], []);

  const handleStopAndSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (!(await ensureSession())) return;
    setStreaming(true);
    const userMsg: UIMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed, streaming: false, attachments: attachments.map((a) => ({ name: a.name })) };
    setMessages((prev) => [...prev, userMsg, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }]);
    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);
    try {
      const result = await chat.stopAndSend(trimmed, fileRefs);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      if (result?.message) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming && !last.content) {
            return [...prev.slice(0, -1), { ...result.message!, streaming: false }];
          }
          return prev;
        });
      }
    } catch { /* handled by SSE */ }
    setStreaming(false);
  }, [attachments, ensureSession]);

  const handleAddToQueue = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    try { await chat.queue(trimmed, fileRefs); } catch { /* ignore */ }
    setAttachments([]);
  }, [attachments]);

  const handleSteer = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (!(await ensureSession())) return;
    setStreaming(true);
    const userMsg: UIMessage = { id: crypto.randomUUID(), role: 'user', content: `↑ ${trimmed}`, streaming: false };
    setMessages((prev) => [...prev, userMsg, { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true }]);
    const fileRefs = attachments.length > 0 ? attachments.map((a) => ({ name: a.name, content: a.content })) : undefined;
    setAttachments([]);
    try {
      const result = await chat.steer(trimmed, fileRefs);
      if (result?.turnId) activeTurnIdRef.current = result.turnId;
      if (result?.async) return;
      if (result?.message) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming && !last.content) {
            return [...prev.slice(0, -1), { ...result.message!, streaming: false }];
          }
          return prev;
        });
      }
    } catch { /* handled by SSE */ }
    setStreaming(false);
  }, [attachments, ensureSession]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, []);

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
      if (session?.parentId || s.parentId) {
        const parentId = session?.parentId ?? s.parentId!;
        setChildSessionDrawer({
          childSessionId: s.id,
          label: s.title ?? 'Background work',
          kind: s.id.startsWith('crew-worker') ? 'crew_worker' : 'sub_agent',
        });
        navigate(`/console/chat/${parentId}`);
        return;
      }
      const visible = historyMsgs.filter((m: any) => m.role !== 'part');
      const mapped = visible.map((m: any) => {
        const modeChange = parseModeChange(m.content);
        const content = repairStreamTextGlitches(stripToolNoise(m.content || ''));
        const parts = Array.isArray(m.parts)
          ? m.parts.map((p: any) => (p.type === 'text' && p.content
            ? { ...p, content: repairStreamTextGlitches(stripToolNoise(p.content, { trim: false })) }
            : p))
          : undefined;
        return {
          ...m, id: m.id || crypto.randomUUID(), streaming: false, content, parts,
          toolCalls: m.toolCalls?.map((tc: any) => ({ ...tc, status: 'done' as const })),
          subAgents: m.subAgents?.map((sa: any) => ({ ...sa, status: 'done' as const })),
          plan: typeof m.plan === 'string' ? JSON.parse(m.plan) : (m.plan || undefined),
          ...(modeChange ? { isModeChange: modeChange } : {}),
        };
      }) as unknown as UIMessage[];
      const hydrated = await hydrateCrewDeliverables(s.id, mapped, crewList);
      setMessages(hydrated.messages);
      if (hydrated.crewWorkers.length > 0) {
        setCrewWorkers(hydrated.crewWorkers);
        setCrewMissionSessionId(s.id);
        crewMissionSessionIdRef.current = s.id;
      }
      setCurrentSessionTitle(s.title ?? `Session ${s.id.slice(0, 8)}`);
      setParentSessionId(session?.parentId ?? s.parentId ?? null);
      setCurrentSessionId(s.id);
      setShowJumpPill(false);
      jumpSuppressScrollTopRef.current = null;
      const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      const persistedUsed = (s as any).tokenUsed ?? s.tokensUsed ?? 0;
      const tokenAvail = Number((s as any).tokenAvailable ?? (s as any).token_available ?? 0);
      if (tokenAvail > 0) setTokenTotal(tokenAvail);
      setTokenUsed(persistedUsed > 0 ? persistedUsed : inputEst + outputEst);
      setCompactionCount((s as any).compactionCount ?? s.compactionCount ?? 0);
      setTokenInput(inputEst);
      setTokenOutput(outputEst);
      tokenInputRef.current = inputEst;
      tokenOutputRef.current = outputEst;
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
    setTokenUsed(0);
    setTokenInput(0);
    setTokenOutput(0);
    setCompactionCount(0);
    setTodoItems([]);
    setShowJumpPill(false);
    setCwd(folder);
    cwdRef.current = folder;
    try {
      await system.setCwd(folder);
      const { sessionId: newSessionId } = await sessions.create(folder);
      setCurrentSessionId(newSessionId);
      currentSessionIdRef.current = newSessionId;
      skipRestoreRef.current = true;
      setView('chat');
      navigate(`/console/chat/${newSessionId}`);
    } catch (e) {
      setCurrentSessionId(null);
      currentSessionIdRef.current = null;
      setWarnings([`Failed to start session: ${e instanceof Error ? e.message : 'Please try a different folder.'}`]);
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
  // Memoized visibleMessages + isLastUser flags to avoid O(n²) computation on every render
  const visibleMessagesWithFlags = useMemo(() => {
    const visible = messages.filter((m) => {
      if (m.role === 'system' && !m.isModeChange) return false;
      if (m.role === 'assistant' && !m.content && !m.thinking && (!m.toolCalls || m.toolCalls.length === 0) && (!m.subAgents || m.subAgents.length === 0) && (!m.parts || m.parts.length === 0)) return false;
      return true;
    });
    
    // Pre-compute isLastUser flag for each message to avoid O(n²) slice/every on render
    return visible.map((msg, idx) => ({
      msg,
      isLastUser: msg.role === 'user' && visible.slice(idx + 1).every(m => m.role !== 'user'),
    }));
  }, [messages]);
  
  const visibleMessages = visibleMessagesWithFlags.map(item => item.msg);

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
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 1.25,
              }}>
                {sessionList.map((s) => (
                  <SessionGridCard
                    key={s.id}
                    session={s}
                    onOpen={handleSelectSession}
                    onDelete={handleDeleteSession}
                  />
                ))}
              </Box>
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
        <Box
          ref={messagesContainerRef}
          sx={{
            flex: 1,
            overflow: 'auto',
            px: 2,
            py: 1.5,
            position: 'relative',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {visibleMessagesWithFlags.length === 0 && !streaming && (
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

          <ChatMessageList
            items={visibleMessagesWithFlags}
            loadingSteps={loadingSteps}
            onResend={handleResend}
            bottomRef={bottomRef}
            onOpenChildSession={openChildSession}
          />

          {streaming && (visibleMessages.length === 0 || (visibleMessages[visibleMessages.length - 1]?.role !== 'assistant')) && (
            <ThinkingIndicator label={loadingSteps?.[0]?.label} />
          )}

           {toolEnablePrompt && (
            <ToolEnableBanner toolId={toolEnablePrompt.toolId} toolName={toolEnablePrompt.toolName} onRespond={() => setToolEnablePrompt(null)} />
          )}

          <ScrollToBottomPill
            visible={showJumpPill}
            onClick={() => {
              const el = messagesContainerRef.current;
              if (el) jumpSuppressScrollTopRef.current = el.scrollTop;
              setShowJumpPill(false);
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
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

          {/* Crew mission status — scoped to the session that started it */}
          {crewMissionSessionId === currentSessionId && (
          <CrewMissionCard
            workers={crewWorkers}
            missionActive={crewMissionActive}
            missionId={crewMissionId}
            interMessages={crewInterMessages}
            placement="standalone"
            onViewWorker={(workerId, crewName) => openChildSession({
              childSessionId: workerId,
              label: crewName,
              kind: 'crew_worker',
            })}
          />
          )}

          {clarification && streaming && (
            <ClarificationPrompt
              data={clarification}
              onRespond={handleClarifyRespond}
            />
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
            {streaming && (
              <Box sx={{ px: 1.25, pt: 0.75, pb: 0.25 }}>
                <ExecutionStatusChip
                  stage={turnActivity?.stage}
                  step={turnActivity?.step}
                  elapsedMs={turnActivity?.elapsedMs}
                />
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
            <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelect} accept=".txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.yaml,.yml,.toml,.csv,.xml,.html,.css,.sh,.sql,.log,.env,.cfg,.ini,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt" />
            <ChatInputBar
              streaming={streaming}
              sendBlocked={sendBlocked}
              sendBlockedReason={sendBlockedReason}
              hasAttachments={attachments.length > 0}
              crewList={crewList}
              onSend={handleSend}
              onCancel={handleCancel}
              onStopAndSend={handleStopAndSend}
              onAddToQueue={handleAddToQueue}
              onSteer={handleSteer}
              clearSignal={inputClearSignal}
            />

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
                      if (m.contextWindow) {
                        setTokenTotal(m.contextWindow);
                        tokenReservedRef.current = Math.min(20000, Math.round(m.contextWindow * 0.15));
                        setTokenReserved(tokenReservedRef.current);
                      }
                      const profile = providerList.find(p => p.id === currentProvider);
    const providerId = profile?.providerId || currentProviderId || currentProvider;
                      if (m.providerId && m.providerId !== providerId) {
                        setCurrentProvider(m.providerId);
                        providers.switch(m.providerId).then(() => {
                          models.switch(m.id, { contextWindow: m.contextWindow, providerId: m.providerId }).catch(() => {});
                        }).catch(() => {});
                      } else {
                        models.switch(m.id, { contextWindow: m.contextWindow, providerId }).catch(() => {});
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

        <ChildSessionDrawer
          open={!!childSessionDrawer}
          state={childSessionDrawer}
          parentSessionTitle={currentSessionTitle ?? undefined}
          onClose={() => setChildSessionDrawer(null)}
        />
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
            <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
              · {compactionCount} compact
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
              height: 4, borderRadius: 2, bgcolor: colors.bg.tertiary,
              '& .MuiLinearProgress-bar': {
                transition: 'transform 0.12s linear',
                bgcolor: tokenPercent > 80 ? colors.accent.red : tokenPercent > 50 ? colors.accent.orange : colors.accent.blue,
              },
            }}
          />
          <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Context limit</Typography>
            <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
              {tokenTotal.toLocaleString()}
            </Typography>
          </Box>
          {(tokenStreaming > 0 || tokenReserved > 0) && (
          <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim }}>Stream / Reserved</Typography>
            <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary }}>
              {tokenStreaming.toLocaleString()} / {tokenReserved.toLocaleString()}
            </Typography>
          </Box>
          )}
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
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, wordBreak: 'break-all', flex: 1, opacity: copiedSessionId ? 0 : 1, transition: 'opacity 0.15s' }}>
                  {copiedSessionId ? '' : currentSessionId}
                </Typography>
                <Tooltip title="Copy session ID">
                  <Box onClick={() => {
                    navigator.clipboard.writeText(currentSessionId).catch(() => {});
                    setCopiedSessionId(true);
                    setTimeout(() => setCopiedSessionId(false), 2000);
                  }} sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: copiedSessionId ? colors.accent.green : colors.text.dim, '&:hover': { color: copiedSessionId ? colors.accent.green : colors.text.primary } }}>
                    {copiedSessionId ? (
                      <span style={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>copied</span>
                    ) : (
                      <ContentCopyIcon sx={{ fontSize: 11 }} />
                    )}
                  </Box>
                </Tooltip>
              </Box>
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
              {item.status === 'completed' && <CheckCircle size={10} color={colors.accent.green} />}
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
      <PlanApprovalModal
        open={!!planApproval}
        title={planApproval?.title ?? 'Plan'}
        steps={planApproval?.steps ?? []}
        onApprove={() => {
          agent.respondToPlan(true).catch(() => {});
          setPlanApproval(null);
        }}
        onReject={() => {
          agent.respondToPlan(false).catch(() => {});
          setPlanApproval(null);
        }}
      />
      <ModeEscalationModal
        open={!!modeEscalation}
        tool={modeEscalation?.tool ?? ''}
        reason={modeEscalation?.reason ?? ''}
        onSwitch={() => {
          agent.respondToModeEscalation(true).then(() => {
            setAgentMode('agent');
            sessionSettings.setMode('agent').catch(() => {});
          }).catch(() => {});
          setModeEscalation(null);
        }}
        onSkip={() => {
          agent.respondToModeEscalation(false).catch(() => {});
          setModeEscalation(null);
          setStreaming(false);
        }}
      />
      <ModeSuggestionModal
        open={modeSuggestOpen}
        onSwitch={() => {
          setModeSuggestOpen(false);
          setAgentMode('agent');
          sessionSettings.setMode('agent').catch(() => {});
          const text = pendingSendTextRef.current;
          pendingSendTextRef.current = null;
          if (text) void executeSend(text);
        }}
        onStay={() => {
          setModeSuggestOpen(false);
          const text = pendingSendTextRef.current;
          pendingSendTextRef.current = null;
          if (text) void executeSend(text);
        }}
        onClose={() => {
          setModeSuggestOpen(false);
          pendingSendTextRef.current = null;
        }}
      />
      <StepCapModal
        open={!!stepCapPrompt}
        currentSteps={stepCapPrompt?.currentSteps ?? 25}
        maxSteps={stepCapPrompt?.maxSteps ?? 25}
        onContinue={() => {
          agent.respondToStepCap(true).catch(() => {});
          setStepCapPrompt(null);
        }}
        onStop={() => {
          agent.respondToStepCap(false).catch(() => {});
          setStepCapPrompt(null);
          setStreaming(false);
        }}
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
