import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
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

import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer';
import RouteIcon from '@mui/icons-material/Route';
import SearchIcon from '@mui/icons-material/Search';
import HistoryIcon from '@mui/icons-material/History';
import DownloadIcon from '@mui/icons-material/Download';
import FlagIcon from '@mui/icons-material/Flag';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { chat, sessions, todos, tools, models, crews, providers, system, sessionSettings, connectSSE, type TelemetryEvent, type ChatMessage, type TodoItem, type SessionInfo, type Crew, type AgentMode, type ModelInfo, type ConnectionState } from '../api';
import { colors } from '../theme';
import {
  ConnectionHealthDot,
  ScrollToBottomPill,
  SlashCommandMenu,
  CommandPalette,
  SessionSearchModal,
  DoomLoopWarning,
  ReasoningBlock,
  CheckpointDrawer,
  TurnTokenBadge,
  StreamingCursor,
  SLASH_COMMANDS,
  CrewMentionMenu,
  type SlashCommand,
  type PaletteAction,
} from './ChatEnhancements';
import { MentionInput } from './MentionInput';
import { FolderPickerModal } from './FolderPickerModal';

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
  doomLoop?: { toolName: string; count: number } | null;
  crew?: { crewId: string; name: string; callsign: string };
}

interface ToolCall {
  id: string;
  name: string;
  args?: string;
  result?: string;
  status: 'running' | 'done' | 'error';
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
        const visible = historyMsgs.filter((m) => m.role !== 'system');
        setMessages(visible.map((m) => ({ ...m, streaming: false })));
        setCurrentSessionTitle(session.title ?? `Session ${sessionId.slice(0, 8)}`);
        const totalUsed = (session as any).tokenUsed ?? session.tokensUsed ?? 0;
        setTokenUsed(totalUsed);
        const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
        setTokenInput(inputEst);
        setTokenOutput(outputEst);
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
  const [tokenTotal] = useState(128000);
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
  const [agentMode, setAgentMode] = useState<AgentMode>('ask');

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
  const [showSlash, setShowSlash] = useState(false);
  const slashQuery = useMemo(() => {
    if (!input.startsWith('/')) return '';
    const line = input.split('\n')[0] ?? '';
    if (line.includes(' ')) return '';
    return line;
  }, [input]);
  useEffect(() => { setShowSlash(slashQuery.length > 0); }, [slashQuery]);

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
    sessionSettings.get().then((s) => { setAgentMode(s.mode); }).catch(() => {});
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

  // Connect SSE for streaming events
  useEffect(() => {
    // Helper to immutably update the last message (avoids React mutation anti-pattern)
    const updateLastMessage = (msgs: UIMessage[], updates: Partial<UIMessage>): UIMessage[] => {
      if (msgs.length === 0) return msgs;
      const last = msgs[msgs.length - 1];
      if (last?.role !== 'assistant') return msgs;
      return [...msgs.slice(0, -1), { ...last, ...updates }];
    };

    const handleEvent = (ev: TelemetryEvent) => {
      // Reset activity timer on every event from the agent
      lastActivityRef.current = Date.now();
      setLastEventAt(Date.now());

      setMessages((prev) => {
        const last = prev[prev.length - 1];

        switch (ev.type) {
          case 'loading_start': {
            // Set up loading steps if provided
            const loadingStepsEvent = ev as { type: 'loading_start'; stage: string; steps?: Array<{ id: string; label: string; status: string }> };
            if (loadingStepsEvent.steps && loadingStepsEvent.steps.length > 0) {
              setLoadingSteps(loadingStepsEvent.steps);
            }
            // If the last assistant message is no longer streaming (closed by
            // a prior loading_end from a fast-reply failure), reuse it instead
            // of creating a duplicate placeholder.
            if (last?.role === 'assistant' && !last.streaming && last.content) {
              setStreaming(true);
              return updateLastMessage(prev, { streaming: true });
            } else if (!last || last.role !== 'assistant' || !last.streaming) {
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

          case 'stream_chunk':
            if (last?.role === 'assistant' && last.streaming) {
              const newContent = (ev.fullContent as string) ?? (last.content + ((ev.content as string) ?? ''));
              return updateLastMessage(prev, { content: newContent });
            } else {
              // If no streaming placeholder exists, create one
              setStreaming(true);
              return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: (ev.content as string) ?? '', streaming: true }];
            }

          case 'loading_end':
            setLoadingSteps(null);
            setStreaming(false);
            return updateLastMessage(prev, { streaming: false });

          case 'message_received': {
            const msg = ev.message as { id?: string; content?: string; role?: string; crew?: { crewId: string; name: string; callsign: string } } | undefined;
            const crew = msg?.crew;
            setStreaming(false);
            if (last?.role === 'assistant') {
              return updateLastMessage(prev, { content: msg?.content ?? last.content, streaming: false, ...(crew ? { crew } : {}) });
            } else if (msg?.content && msg.role === 'assistant') {
              return [...prev, { id: msg.id || crypto.randomUUID(), role: 'assistant', content: msg.content, streaming: false, ...(crew ? { crew } : {}) }];
            }
            return prev;
          }

          case 'tool_executing': {
            if (last?.role !== 'assistant') return prev;
            const toolName = (ev.tool as string) ?? 'unknown';
            if (toolName === 'delegate_to_subagent') {
              const sa: SubAgent = { id: crypto.randomUUID(), name: 'Sub-Agent', task: (ev.description as string) ?? '', status: 'running' };
              return updateLastMessage(prev, { subAgents: [...(last.subAgents ?? []), sa] });
            } else {
              const tc: ToolCall = { id: crypto.randomUUID(), name: toolName, args: (ev.description as string) ?? '', status: 'running' };
              const newToolCalls = [...(last.toolCalls ?? []), tc];
              // Doom-loop detection: same tool called 3+ times in a row with similar args
              const recent = newToolCalls.slice(-4);
              let doomLoop = last.doomLoop;
              if (recent.length >= 3) {
                const same = recent.slice(-3).every(t => t.name === toolName && (t.args ?? '').slice(0, 80) === (tc.args ?? '').slice(0, 80));
                doomLoop = same ? { toolName, count: recent.filter(t => t.name === toolName).length } : null;
              }
              return updateLastMessage(prev, { toolCalls: newToolCalls, doomLoop });
            }
          }

          case 'doom_loop':
            return last?.role === 'assistant'
              ? updateLastMessage(prev, { doomLoop: { toolName: (ev.tool as string) ?? 'unknown', count: (ev.count as number) ?? 3 } })
              : prev;

          case 'tool_complete': {
            if (last?.role !== 'assistant') return prev;
            const toolName = (ev.tool as string) ?? '';
            if (toolName === 'delegate_to_subagent' && last.subAgents) {
              const newSubAgents = last.subAgents.map((a) => {
                if (a.status !== 'running') return a;
                const result = ev.result as { output?: string; success?: boolean } | string | undefined;
                return { ...a, status: 'done' as const, result: typeof result === 'string' ? result : result?.output ?? 'Done' };
              });
              return updateLastMessage(prev, { subAgents: newSubAgents });
            } else if (last.toolCalls) {
              let foundToolError = false;
              const newToolCalls = last.toolCalls.map((t) => {
                if (t.name !== toolName || t.status !== 'running') return t;
                const result = ev.result;
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result ?? '');
                const resObj = typeof result === 'object' && result !== null ? result as Record<string, unknown> : null;
                if (resObj?.error === 'TOOL_NOT_FOUND' || resObj?.error === 'NO_HANDLER') foundToolError = true;
                return { ...t, status: 'done' as const, result: resultStr };
              });
              if (foundToolError) setToolEnablePrompt({ toolId: toolName, toolName });
              return updateLastMessage(prev, { toolCalls: newToolCalls });
            }
            return prev;
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
            setWarnings(prev => prev.includes(msg) ? prev : [...prev, msg]);
            if (providerErrorTimerRef.current) clearTimeout(providerErrorTimerRef.current);
            setStreaming(false);
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
            setWarnings(prev => prev.includes(errorText) ? prev : [...prev, errorText]);
            setStreaming(false);
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
      onState: (state) => { setConnState(state); if (state === 'open') setLastEventAt(Date.now()); },
    });
    return () => { disconnectRef.current?.(); };
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

  // Streaming timeout — if no content or events arrive within 120s, fail gracefully
  // Uses a ref to reset the timer on each new event (activity-based timeout)
  const lastActivityRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!streaming) return;
    lastActivityRef.current = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 120000) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming && !last.content) {
            return [...prev.slice(0, -1), { ...last, content: '⚠️ Request timed out. The agent took too long to respond. Please try again.', streaming: false }];
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
    if (text.startsWith('/')) {
      const handled = await runSlashCommand(text);
      if (handled) {
        setInput('');
        return;
      }
    }
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
    // Add user message + a placeholder assistant message to show thinking immediately
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true },
    ]);

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
        setWarnings(prev => prev.includes(msg) ? prev : [...prev, msg]);
        if (providerErrorTimerRef.current) clearTimeout(providerErrorTimerRef.current);
        // Clear server-side agent processing state so next message isn't blocked
        chat.cancel().catch(() => {});
      } else {
        // Non-provider errors (e.g., "Agent is busy") — also show in warning band
        setWarnings(prev => prev.includes(displayError) ? prev : [...prev, displayError]);
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
  }, [input, streaming, attachments, currentProvider, currentModel]);

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
  const runSlashCommand = useCallback(async (raw: string): Promise<boolean> => {
    const line = raw.trim();
    if (!line.startsWith('/')) return false;
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const argStr = rest.join(' ');
    const sid = currentSessionId;
    switch (cmd) {
      case 'help': {
        const helpText = 'Available slash commands:\n\n' + SLASH_COMMANDS.map(c => `**${c.name}** — ${c.description}`).join('\n');
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: helpText, streaming: false }]);
        return true;
      }
      case 'clear': {
        try { await chat.clear(); } catch { /* ignore */ }
        setMessages([]);
        setTokenUsed(0);
        setTokenInput(0);
        setTokenOutput(0);
        setCompactionCount(0);
        return true;
      }
      case 'compact': {
        if (!sid) return true;
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '✨ Compacting session…', streaming: true }]);
        try {
          const r = await sessions.compact(sid);
          setMessages(prev => {
            const m = [...prev];
            const last = m[m.length - 1];
            if (last?.streaming) { last.streaming = false; last.content = `✨ Session compacted.\n\n${r.summary || ''}`; }
            return m;
          });
        } catch (e) {
          setMessages(prev => [...prev.slice(0, -1), { id: crypto.randomUUID(), role: 'assistant', content: `⚠️ Compaction failed: ${e instanceof Error ? e.message : 'unknown'}`, streaming: false }]);
        }
        return true;
      }
      case 'retry': {
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        if (lastUser?.content) {
          setInput(lastUser.content);
          setTimeout(() => handleSend(), 50);
        }
        return true;
      }
      case 'undo': {
        if (!sid) return true;
        try {
          const list = await sessions.checkpoints(sid);
          if (list.length === 0) {
            setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '⚠️ No checkpoints available. Use `/checkpoint` to save one first.', streaming: false }]);
            return true;
          }
          await sessions.restoreCheckpoint(sid, list[0]!.id);
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
        return true;
      }
      case 'checkpoint': {
        if (!sid) return true;
        try {
          const r = await sessions.checkpoint(sid, argStr || undefined);
          setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: `📝 Checkpoint saved: **${r.label}**`, streaming: false }]);
        } catch { /* ignore */ }
        return true;
      }
      case 'checkpoints': {
        setCheckpointsOpen(true);
        return true;
      }
      case 'search': {
        setSearchOpen(true);
        return true;
      }
      case 'think': {
        // Force plan mode for this turn
        setAgentMode('plan');
        sessionSettings.setMode('plan').catch(() => {});
        if (argStr) {
          setInput(argStr);
          setTimeout(() => handleSend(), 30);
        }
        return true;
      }
      case 'export': {
        if (!sid) return true;
        sessions.exportTrajectory(sid);
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: `📦 Exporting trajectory for session **${sid.slice(0, 8)}**…`, streaming: false }]);
        return true;
      }
      case 'goal': {
        if (!argStr) {
          setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '⚠️ Usage: `/goal <multi-step objective>`', streaming: false }]);
          return true;
        }
        // Goal mode: force plan mode + prepend a goal-framing instruction
        setAgentMode('plan');
        sessionSettings.setMode('plan').catch(() => {});
        setInput(`🎯 GOAL: ${argStr}\n\nBreak this down into concrete steps, then execute them. Use the task tracker. Stop and report after each major milestone.`);
        setTimeout(() => handleSend(), 30);
        return true;
      }
      default:
        return false;
    }
  }, [currentSessionId, messages]);

  // ─── Global keyboard shortcuts (declared after runSlashCommand to avoid TDZ) ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (currentSessionId) {
          e.preventDefault();
          runSlashCommand('/undo');
        }
      } else if (e.key === 'Escape' && streaming) {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentSessionId, streaming, runSlashCommand]);

  // ─── Command palette actions (declared after runSlashCommand to avoid TDZ) ───
  const paletteActions: PaletteAction[] = useMemo(() => [
    { id: 'new-session', label: 'New session', hint: 'N', icon: <AddIcon sx={{ fontSize: 14 }} />, run: () => handleNewSession() },
    { id: 'sessions', label: 'Show all sessions', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => handleShowSessions() },
    { id: 'search', label: 'Search sessions', hint: '⌘F', icon: <SearchIcon sx={{ fontSize: 14 }} />, run: () => setSearchOpen(true) },
    { id: 'checkpoints', label: 'Open checkpoints', icon: <HistoryIcon sx={{ fontSize: 14 }} />, run: () => setCheckpointsOpen(true) },
    { id: 'clear', label: 'Clear chat', icon: <DeleteIcon sx={{ fontSize: 14 }} />, run: () => runSlashCommand('/clear') },
    { id: 'compact', label: 'Compact session', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => runSlashCommand('/compact') },
    { id: 'undo', label: 'Undo (restore latest checkpoint)', hint: '⌘Z', icon: <ArrowBackIcon sx={{ fontSize: 14 }} />, run: () => runSlashCommand('/undo') },
    { id: 'retry', label: 'Retry last message', icon: <SendIcon sx={{ fontSize: 14 }} />, run: () => runSlashCommand('/retry') },
    { id: 'export', label: 'Export trajectory (JSON)', icon: <DownloadIcon sx={{ fontSize: 14 }} />, run: () => runSlashCommand('/export') },
    { id: 'goal', label: 'Set Goal Mode objective', icon: <FlagIcon sx={{ fontSize: 14 }} />, run: () => { setInput('/goal '); } },
    { id: 'mode-agent', label: 'Switch mode → Agent', icon: <SmartToyIcon sx={{ fontSize: 14 }} />, run: () => { setAgentMode('agent'); sessionSettings.setMode('agent').catch(() => {}); } },
    { id: 'mode-plan', label: 'Switch mode → Plan', icon: <RouteIcon sx={{ fontSize: 14 }} />, run: () => { setAgentMode('plan'); sessionSettings.setMode('plan').catch(() => {}); } },
    { id: 'mode-ask', label: 'Switch mode → Ask', icon: <QuestionAnswerIcon sx={{ fontSize: 14 }} />, run: () => { setAgentMode('ask'); sessionSettings.setMode('ask').catch(() => {}); } },
  ], [runSlashCommand]);

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
      const { messages: historyMsgs } = await sessions.restore(s.id);
      const visible = historyMsgs.filter((m) => m.role !== 'system');
      setMessages(visible.map((m) => ({ ...m, streaming: false })));
      setCurrentSessionTitle(s.title ?? `Session ${s.id.slice(0, 8)}`);
      setCurrentSessionId(s.id);
      setShowJumpPill(false);
      setUnreadCount(0);
      setTokenUsed(s.tokensUsed ?? 0);
      const inputEst = visible.filter(m => m.role === 'user').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      const outputEst = visible.filter(m => m.role === 'assistant').reduce((acc, m) => acc + (m.tokenCount ?? Math.ceil((m.content?.length ?? 0) / 4)), 0);
      setTokenInput(inputEst);
      setTokenOutput(outputEst);
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

          {visibleMessages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              loadingSteps={idx === visibleMessages.length - 1 && msg.streaming && !msg.content ? loadingSteps : null}
            />
          ))}
          {streaming && (visibleMessages.length === 0 || (visibleMessages[visibleMessages.length - 1]?.role !== 'assistant')) && (
            <ThinkingIndicator label={loadingSteps?.[0]?.label} />
          )}

          {permissionPrompt && (
            <PermissionBanner prompt={permissionPrompt} onRespond={() => setPermissionPrompt(null)} />
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
              px: 1.5,
              pt: 1,
              pb: 3,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 0.75,
              maxHeight: 250,
            }}>
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.3, overflowY: 'auto', maxHeight: 240, pb: 2 }}>
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
            border: `1px solid ${agentMode === 'agent' ? colors.accent.orange + '60' : agentMode === 'plan' ? colors.accent.purple + '60' : colors.border.default}`,
            borderRadius: '14px',
            bgcolor: colors.bg.tertiary,
            backgroundImage: agentMode === 'agent' ? `linear-gradient(${colors.accent.orange}08, ${colors.accent.orange}08)` : agentMode === 'plan' ? `linear-gradient(${colors.accent.purple}08, ${colors.accent.purple}08)` : 'none',
            transition: 'border-color 0.2s, background-color 0.2s',
            '&:focus-within': { borderColor: agentMode === 'agent' ? colors.accent.orange + '90' : agentMode === 'plan' ? colors.accent.purple + '90' : colors.border.strong },
          }}>
            {/* Slash command autocomplete */}
            {showSlash && (
              <SlashCommandMenu
                query={slashQuery}
                onSelect={(cmd: SlashCommand) => {
                  setInput(cmd.example ? cmd.name + ' ' : cmd.name);
                  setShowSlash(false);
                }}
                onClose={() => setShowSlash(false)}
              />
            )}
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
                  <IconButton size="small" onClick={(e) => input.trim() ? setSendMenuAnchor(e.currentTarget) : handleCancel()} sx={{ color: colors.accent.red, p: 0.5 }}>
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
              <Tooltip title={agentMode === 'agent' ? 'Agent — full autonomy, auto-approves tools' : agentMode === 'plan' ? 'Plan — generates plans, tools need approval' : 'Ask — chat & planning only, no tools'} arrow>
                <Chip
                  size="small"
                  icon={agentMode === 'agent' ? <SmartToyIcon sx={{ fontSize: '12px !important' }} /> : agentMode === 'plan' ? <RouteIcon sx={{ fontSize: '12px !important' }} /> : <QuestionAnswerIcon sx={{ fontSize: '12px !important' }} />}
                  label={agentMode.charAt(0).toUpperCase() + agentMode.slice(1)}
                  onClick={(e) => setModeMenuAnchor(e.currentTarget)}
                  sx={{
                    fontSize: '0.55rem', height: 20, cursor: 'pointer',
                    bgcolor: 'transparent', border: 'none',
                    color: agentMode === 'agent' ? colors.accent.orange : agentMode === 'plan' ? colors.accent.purple : colors.text.secondary,
                    '&:hover': { bgcolor: colors.bg.primary },
                  }}
                />
              </Tooltip>

              <Menu anchorEl={modeMenuAnchor} open={Boolean(modeMenuAnchor)} onClose={() => setModeMenuAnchor(null)}
                PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, minWidth: 200 } }}>
                <MenuItem onClick={() => { setAgentMode('agent'); sessionSettings.setMode('agent').catch(() => {}); setModeMenuAnchor(null); }}
                  selected={agentMode === 'agent'} sx={{ fontSize: '0.7rem', py: 0.75 }}>
                  <SmartToyIcon sx={{ fontSize: 14, mr: 1, color: colors.accent.orange }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 500 }}>Agent</Typography>
                    <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Full autonomy — answers, plans & executes freely</Typography>
                  </Box>
                </MenuItem>
                <MenuItem onClick={() => { setAgentMode('plan'); sessionSettings.setMode('plan').catch(() => {}); setModeMenuAnchor(null); }}
                  selected={agentMode === 'plan'} sx={{ fontSize: '0.7rem', py: 0.75 }}>
                  <RouteIcon sx={{ fontSize: 14, mr: 1, color: colors.accent.purple }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 500 }}>Plan</Typography>
                    <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Generates plans — tools require permission</Typography>
                  </Box>
                </MenuItem>
                <MenuItem onClick={() => { setAgentMode('ask'); sessionSettings.setMode('ask').catch(() => {}); setModeMenuAnchor(null); }}
                  selected={agentMode === 'ask'} sx={{ fontSize: '0.7rem', py: 0.75 }}>
                  <QuestionAnswerIcon sx={{ fontSize: 14, mr: 1, color: colors.text.secondary }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 500 }}>Ask</Typography>
                    <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Chat & planning only — no code execution</Typography>
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
            • Use the approval mode ("Ask" / "Moderate" / "Auto") to control how much autonomy Agent-X has.
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

const MARKDOWN_COMPONENTS = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className ?? '');
    const code = String(children).replace(/\n$/, '');
    if (match) {
      return (<SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ borderRadius: 6, fontSize: '0.7rem', margin: '6px 0', padding: '10px 12px' }}>{code}</SyntaxHighlighter>);
    }
    return <code className={className} style={{ background: colors.bg.tertiary, padding: '1px 5px', borderRadius: 3, fontSize: '0.72rem' }} {...props}>{children}</code>;
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

  if (!hasCrew) {
    return (
      <Box sx={{ ...MARKDOWN_BASE_SX, '& p': { ...MARKDOWN_BASE_SX['& p'], color: colors.text.primary } }}>
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
              <Box sx={{ ...MARKDOWN_BASE_SX, '& p': { ...MARKDOWN_BASE_SX['& p'], color: cc } }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{seg.text}</ReactMarkdown>
              </Box>
            </Box>
          );
        }
        return (
          <Box key={i} sx={{ ...MARKDOWN_BASE_SX, '& p': { ...MARKDOWN_BASE_SX['& p'], color: colors.text.primary } }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{seg.text}</ReactMarkdown>
          </Box>
        );
      })}
    </Box>
  );
}

function getResponderName(content: string): { name: string; callsign: string } | null {
  const match = content.match(/^\*\*([^*]+)\*\*\s*\(@(\w+)\):/);
  if (match) return { name: match[1].trim(), callsign: match[2] };
  return null;
}

function MessageBubble({ message, loadingSteps }: { message: UIMessage; loadingSteps?: Array<{ id: string; label: string; status: string }> | null }) {
  const isUser = message.role === 'user';
  const crewInfo = message.crew;
  const responderName = !isUser && !crewInfo && message.content ? getResponderName(message.content) : null;

  const displayName = crewInfo ? crewInfo.name : (responderName ? responderName.name : 'Agent-X');
  const displayColor = crewInfo ? getWebCrewColor(crewInfo.callsign) : (responderName ? getWebCrewColor(responderName.callsign) : colors.accent.blue);
  const displayInitial = crewInfo ? crewInfo.name.charAt(0).toUpperCase() : null;

  if (message.role === 'system') return null;

  return (
    <Box sx={{
      mb: 2, display: 'flex', gap: 1.5,
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      animation: 'agentx-fadeIn 0.25s ease-out',
    }}>
      {/* Avatar — only for assistant */}
      {!isUser && (
        <Box sx={{
          width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: displayColor + '18', mt: 0.5, flexShrink: 0,
          border: crewInfo ? `1px solid ${displayColor}40` : 'none',
        }}>
          {displayInitial ? (
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: displayColor, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
              {displayInitial}
            </Typography>
          ) : (
            <SmartToyIcon sx={{ fontSize: 15, color: colors.accent.purple }} />
          )}
        </Box>
      )}

      {/* Bubble content */}
      <Box sx={{ minWidth: 0, maxWidth: isUser ? '72%' : '85%' }}>
        {/* Responder name label */}
        {!isUser && (
          <Typography sx={{
            fontSize: '0.6rem', fontWeight: 600,
            color: displayColor,
            fontFamily: "'JetBrains Mono', monospace",
            mb: 0.5,
            letterSpacing: '0.5px',
          }}>
            {displayName}
          </Typography>
        )}
        <Box sx={{
          ...(isUser ? {
            bgcolor: colors.accent.blue + '10',
            border: `1px solid ${colors.accent.blue}20`,
            borderRadius: '14px 14px 4px 14px',
            px: 1.75, py: 1,
          } : {
            bgcolor: displayColor + '08',
            border: `1px solid ${displayColor}15`,
            borderRadius: '14px 14px 14px 4px',
            px: 1.75, py: 1,
          }),
        }}>
        {/* Reasoning (first-class) */}
        {message.thinking && !isUser && (
          <ReasoningBlock
            text={message.thinking}
            streaming={message.streaming && !message.thinkingDoneAt}
            durationMs={message.thinkingDoneAt && message.thinkingStartedAt ? (message.thinkingDoneAt - message.thinkingStartedAt) : undefined}
          />
        )}

        {/* Doom-loop warning */}
        {message.doomLoop && !isUser && (
          <DoomLoopWarning
            toolName={message.doomLoop.toolName}
            count={message.doomLoop.count}
            onContinue={() => { /* user dismisses; cleared on next user turn */ }}
            onStop={() => { chat.cancel().catch(() => {}); }}
          />
        )}

        {/* Plan */}
        {message.plan && message.plan.length > 0 && (
          <Box sx={{ mb: 0.75, p: 1, borderRadius: 1, border: `1px solid ${colors.accent.blue}20`, bgcolor: colors.accent.blue + '05' }}>
            <Typography sx={{ fontSize: '0.55rem', fontWeight: 600, color: colors.accent.blue, mb: 0.3 }}>Plan</Typography>
            {message.plan.map((step, i) => (
              <Typography key={i} sx={{ fontSize: '0.6rem', color: colors.text.secondary, pl: 1 }}>{i + 1}. {step}</Typography>
            ))}
          </Box>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <Box sx={{ mb: 0.75 }}>{message.toolCalls.map((tc) => (<ToolCallChip key={tc.id} tool={tc} />))}</Box>
        )}

        {/* Sub agents */}
        {message.subAgents && message.subAgents.length > 0 && (
          <Box sx={{ mb: 0.75 }}>{message.subAgents.map((sa) => (<SubAgentChip key={sa.id} agent={sa} />))}</Box>
        )}

        {/* Inline todos */}
        {message.todos && message.todos.length > 0 && (<InlineTodoList items={message.todos} />)}

        {/* File attachments on user messages */}
        {isUser && message.attachments && message.attachments.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
            {message.attachments.map((a, i) => (
              <Chip key={i} size="small" icon={<InsertDriveFileIcon sx={{ fontSize: '11px !important' }} />} label={a.name}
                sx={{ fontSize: '0.5rem', height: 18, bgcolor: colors.accent.blue + '08', border: `1px solid ${colors.accent.blue}20` }} />
            ))}
          </Box>
        )}

        {/* Message text (crew-aware) */}
        {message.content && !isUser && <CrewAwareMarkdown content={message.content} />}
        {message.content && isUser && <UserMentionText content={message.content} />}

        {/* Streaming dots (empty content, no steps) */}
        {message.streaming && !message.content && !loadingSteps && (
          <Box sx={{ display: 'flex', gap: 0.4, py: 0.5 }}>
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out infinite' }} />
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.2s infinite' }} />
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: colors.accent.purple, animation: 'agentx-pulse 1.4s ease-in-out 0.4s infinite' }} />
          </Box>
        )}

        {/* Shimmer bar while streaming content */}
        {message.streaming && message.content && (
          <>
            <Box component="span" sx={{ display: 'inline' }}><StreamingCursor /></Box>
            <Box sx={{
              mt: 0.5, height: 2, borderRadius: 1, width: '50%',
              background: `linear-gradient(90deg, transparent, ${colors.accent.purple}50, transparent)`,
              backgroundSize: '200% 100%',
              animation: 'agentx-shimmer 1.5s infinite linear',
            }} />
          </>
        )}

        {/* Per-turn token economics badge */}
        {!isUser && !message.streaming && (message.turnTokens != null || message.turnCostUsd != null) && (
          <TurnTokenBadge tokens={message.turnTokens} />
        )}
      </Box>
      </Box>
    </Box>
  );
}

// ─── Tool Call Chip ───

function ToolCallChip({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box sx={{ mb: 0.5 }}>
      <Chip size="small"
        label={tool.name}
        onClick={() => setExpanded(!expanded)}
        sx={{
          fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", height: 20,
          bgcolor: tool.status === 'running' ? colors.accent.orange + '10' : tool.status === 'error' ? colors.accent.red + '10' : colors.accent.green + '10',
          border: `1px solid ${tool.status === 'running' ? colors.accent.orange : tool.status === 'error' ? colors.accent.red : colors.accent.green}20`,
          color: tool.status === 'running' ? colors.accent.orange : tool.status === 'error' ? colors.accent.red : colors.accent.green,
          cursor: 'pointer',
        }}
      />
      <Collapse in={expanded}>
        {tool.args && <Box sx={{ mt: 0.5, p: 0.75, fontSize: '0.55rem', bgcolor: colors.bg.tertiary, borderRadius: 1, fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto' }}>{tool.args}</Box>}
        {tool.result && <Box sx={{ mt: 0.5, p: 0.75, fontSize: '0.55rem', bgcolor: colors.bg.tertiary, borderRadius: 1, fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto' }}>{tool.result}</Box>}
      </Collapse>
    </Box>
  );
}

// ─── Sub-Agent Chip ───

function SubAgentChip({ agent }: { agent: SubAgent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box sx={{ mb: 0.5 }}>
      <Chip size="small"
        icon={agent.status === 'running' ? <CircularProgress size={10} sx={{ color: 'inherit' }} /> : <AccountTreeIcon sx={{ fontSize: 11 }} />}
        label={`${agent.name}: ${agent.task.slice(0, 35)}${agent.task.length > 35 ? '…' : ''}`}
        onClick={() => setExpanded(!expanded)}
        sx={{
          fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", height: 20,
          bgcolor: agent.status === 'running' ? colors.accent.purple + '10' : colors.accent.green + '10',
          border: `1px solid ${agent.status === 'running' ? colors.accent.purple : colors.accent.green}20`,
          color: agent.status === 'running' ? colors.accent.purple : colors.accent.green,
          cursor: 'pointer',
        }}
      />
      <Collapse in={expanded}>
        {agent.result && <Box sx={{ mt: 0.5, p: 0.75, fontSize: '0.55rem', bgcolor: colors.bg.tertiary, borderRadius: 1, fontFamily: "'JetBrains Mono', monospace", color: colors.text.secondary, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>{agent.result}</Box>}
      </Collapse>
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
  const bgColor = isCritical ? colors.accent.red + '08' : isHigh ? colors.accent.orange + '08' : colors.accent.orange + '05';
  const titleColor = isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.orange;

  return (
    <Box sx={{ p: 1.5, mb: 2, borderRadius: 1, border: `1px solid ${borderColor}`, bgcolor: bgColor, animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: titleColor }}>
          {isCritical ? '⚠ Critical Permission Required' : isHigh ? '⚡ High-Risk Permission' : 'Permission Required'}
        </Typography>
        <Chip size="small" label={prompt.riskLevel.toUpperCase()} sx={{
          fontSize: '0.45rem', height: 15, fontWeight: 600,
          bgcolor: isCritical ? colors.accent.red + '20' : isHigh ? colors.accent.orange + '20' : colors.accent.blue + '15',
          color: isCritical ? colors.accent.red : isHigh ? colors.accent.orange : colors.accent.blue,
        }} />
      </Box>
      <Typography sx={{ fontSize: '0.6rem', mb: 0.25, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
        {prompt.tool}
      </Typography>
      {prompt.path && (
        <Typography sx={{ fontSize: '0.55rem', mb: 1, color: colors.text.dim, wordBreak: 'break-all' }}>
          {prompt.path}
        </Typography>
      )}
      {isCritical && (
        <Typography sx={{ fontSize: '0.5rem', mb: 1, color: colors.accent.red, fontStyle: 'italic' }}>
          This operation could permanently affect your system. Review carefully before allowing.
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        <Chip size="small" label="Allow Once" onClick={() => handleRespond('allow_once')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.green + '12', color: colors.accent.green, '&:hover': { bgcolor: colors.accent.green + '25' } }} />
        <Chip size="small" label="Always" onClick={() => handleRespond('allow_always')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.blue + '12', color: colors.accent.blue, '&:hover': { bgcolor: colors.accent.blue + '25' } }} />
        <Chip size="small" label="Deny" onClick={() => handleRespond('deny')} sx={{ cursor: 'pointer', height: 20, fontSize: '0.5rem', bgcolor: colors.accent.red + '12', color: colors.accent.red, '&:hover': { bgcolor: colors.accent.red + '25' } }} />
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
